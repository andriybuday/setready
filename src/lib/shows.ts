import { normalizeName, showSlug } from "./normalize";
import { upsertTour } from "./tours";
import { getMostRecentSetlist, searchArtists, type RecentSetlist } from "./setlistfm";
import { getLineup } from "./ticketmaster";

export interface BuildInput {
  headliner: string;
  /** YYYY-MM-DD */
  date: string;
  /** Optional manual lineup, support first / headliner last. */
  bands?: string[];
}

export interface BandResult {
  band: string;
  setlist: RecentSetlist | null;
  suggestions: string[];
}

export interface BuiltShow {
  slug: string;
  title: string;
  venue: string;
  tourName: string;
  tourSlug: string;
  eventDate: string;
  bands: BandResult[];
}

/** "Tour — A, B & C 2026" naming carried over from the prototype. */
export function playlistTitle(bands: string[], tourName: string, year: string): string {
  const bandsStr =
    bands.length <= 2
      ? bands.join(" & ")
      : `${bands.slice(0, -1).join(", ")} & ${bands[bands.length - 1]}`;
  return tourName ? `${tourName} — ${bandsStr} ${year}` : `${bandsStr} ${year}`;
}

async function upsertArtist(db: D1Database, name: string): Promise<number> {
  const normalized = normalizeName(name);
  await db
    .prepare(
      `INSERT INTO artists (name, normalized_name) VALUES (?, ?)
       ON CONFLICT(normalized_name) DO NOTHING`,
    )
    .bind(name, normalized)
    .run();
  const row = await db
    .prepare("SELECT id FROM artists WHERE normalized_name = ?")
    .bind(normalized)
    .first<{ id: number }>();
  if (!row) throw new Error(`artist upsert failed for ${name}`);
  return row.id;
}

/**
 * Build (or rebuild) a show: resolve the lineup (manual bands, else
 * Ticketmaster, else headliner only), fetch each band's most recent
 * setlist before the event date, and persist everything to D1.
 */
export async function buildShow(
  db: D1Database,
  input: BuildInput,
  keys: { setlistfm: string; ticketmaster?: string },
): Promise<BuiltShow> {
  const headliner = input.headliner.trim();
  const date = input.date.trim();
  if (!headliner || !date) throw new Error("headliner and date are required");

  let bands = (input.bands ?? []).map((b) => b.trim()).filter(Boolean);
  let venue = "";
  let tourName = "";
  if (keys.ticketmaster) {
    const found = await getLineup(headliner, date, keys.ticketmaster);
    if (found) {
      // Manual bands keep the caller's playing order; Ticketmaster only
      // fills in venue/tour for them.
      if (bands.length === 0) bands = found.lineup;
      venue = found.venue;
      tourName = found.tourName;
    }
  }
  if (bands.length === 0) bands = [headliner];

  const slug = showSlug(headliner, date);
  const bandRefs = [];
  for (const band of bands) {
    bandRefs.push({ id: await upsertArtist(db, band), name: band });
  }
  const headlinerRef = bandRefs[bandRefs.length - 1] as { id: number; name: string };
  const headlinerId = headlinerRef.id;
  const title = playlistTitle(bands, tourName, date.slice(0, 4));
  const tour = await upsertTour(db, {
    tourName,
    title,
    headliner: headlinerRef,
    bands: bandRefs,
    year: date.slice(0, 4),
  });

  await db
    .prepare(
      `INSERT INTO shows (slug, title, headliner_artist_id, venue, event_date, tour_name, tour_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'predicted')
       ON CONFLICT(slug) DO UPDATE SET
         title = excluded.title, venue = excluded.venue,
         tour_name = excluded.tour_name, tour_id = excluded.tour_id,
         updated_at = datetime('now')`,
    )
    .bind(slug, title, headlinerId, venue || null, date, tourName || null, tour.id)
    .run();
  const show = await db
    .prepare("SELECT id FROM shows WHERE slug = ?")
    .bind(slug)
    .first<{ id: number }>();
  if (!show) throw new Error("show upsert failed");

  // Rebuild lineup + songs for this show.
  await db.prepare("DELETE FROM songs WHERE show_id = ?").bind(show.id).run();
  await db.prepare("DELETE FROM show_artists WHERE show_id = ?").bind(show.id).run();

  const results: BandResult[] = [];
  for (const [i, band] of bands.entries()) {
    const artistId = (bandRefs[i] as { id: number }).id;
    const setlist = await getMostRecentSetlist(band, date, keys.setlistfm);
    await db
      .prepare(
        `INSERT INTO show_artists
           (show_id, artist_id, position, is_headliner, source_mode,
            source_setlist_id, source_setlist_date, source_setlist_url)
         VALUES (?, ?, ?, ?, 'last_show', ?, ?, ?)`,
      )
      .bind(
        show.id,
        artistId,
        i + 1,
        i === bands.length - 1 ? 1 : 0,
        setlist?.setlistId || null,
        setlist?.date || null,
        setlist?.url || null,
      )
      .run();
    if (setlist) {
      for (const [j, song] of setlist.songs.entries()) {
        await db
          .prepare(
            `INSERT INTO songs
               (show_id, artist_id, position, title, normalized_title,
                original_artist, is_tape, included)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
          )
          .bind(
            show.id,
            artistId,
            j + 1,
            song.title,
            normalizeName(song.title),
            song.originalArtist,
            song.tape ? 1 : 0,
          )
          .run();
      }
    }
    results.push({
      band,
      setlist,
      suggestions: setlist ? [] : await searchArtists(band, keys.setlistfm),
    });
  }

  return {
    slug,
    title,
    venue,
    tourName,
    tourSlug: tour.slug,
    eventDate: date,
    bands: results,
  };
}
