import { normalizeName, showSlug } from "./normalize";
import { predictSetlist } from "./predict";
import { getRecentSetlists, getSetlistOnDate } from "./setlistfm";
import { upsertTour } from "./tours";
import { getMostRecentSetlist, searchArtists, type RecentSetlist } from "./setlistfm";
import { getLineup } from "./ticketmaster";

export type BuildMode = "last_show" | "predicted" | "actual";

export interface BuildInput {
  headliner: string;
  /** YYYY-MM-DD */
  date: string;
  /** Optional manual lineup, support first / headliner last. */
  bands?: string[];
  mode?: BuildMode;
  status?: "predicted" | "frozen" | "actual";
  /** Pause between band lookups (scheduled jobs throttle setlist.fm). */
  delayMs?: number;
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

function titleCaseTour(tourName: string): string {
  if (tourName !== tourName.toUpperCase()) return tourName;
  return tourName.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Search-first canonical title: every band in billing order (headliner
 * first — the reverse of the input playing order), then tour (when it
 * fits), ending with the discoverable brand suffix. The playlist
 * tracks themselves stay in playing order; only the title is billing.
 * Both Spotify and YouTube cap playlist titles around 100 characters,
 * so generic tour words are shortened before anything is dropped.
 */
export function playlistTitle(bandsInPlayingOrder: string[], tourName: string, year: string): string {
  const bands = [...bandsInPlayingOrder].reverse();
  const bandsStr =
    bands.length <= 2
      ? bands.join(" & ")
      : `${bands.slice(0, -1).join(", ")} & ${bands[bands.length - 1]}`;
  const suffix = "Setlist Playlist · SetReady";
  const tour = titleCaseTour(tourName.trim());
  const tourWithYear = tour && !tour.includes(year) ? `${tour} ${year}` : tour;
  // A named tour is a high-value search phrase: shorten generic words
  // ("World Tour", "Playlist") before ever dropping the tour or a band.
  const shortTour = tour.replace(/\s+(World\s+Tour|Tour)$/i, "");
  const shortTourWithYear =
    shortTour && !shortTour.includes(year) ? `${shortTour} ${year}` : shortTour;
  const candidates = [
    tour ? `${bandsStr} — ${tourWithYear} ${suffix}` : "",
    tour
      ? `${bands.join(" + ")} — ${shortTourWithYear} Setlist · SetReady`
      : "",
    `${bandsStr} ${year} ${suffix}`,
    `${bandsStr} ${suffix}`,
  ].filter(Boolean);
  for (const c of candidates) {
    if (c.length <= 100) return c;
  }
  // Last resort: keep the suffix intact and ellipsize the band list.
  const room = 100 - suffix.length - 1;
  return `${bandsStr.slice(0, room - 1).trimEnd()}… ${suffix}`;
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
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET
         title = excluded.title, venue = excluded.venue,
         tour_name = excluded.tour_name, tour_id = excluded.tour_id,
         status = excluded.status,
         updated_at = datetime('now')`,
    )
    .bind(slug, title, headlinerId, venue || null, date, tourName || null, tour.id, input.status ?? "predicted")
    .run();
  const show = await db
    .prepare("SELECT id FROM shows WHERE slug = ?")
    .bind(slug)
    .first<{ id: number }>();
  if (!show) throw new Error("show upsert failed");

  // Preserve the operator's unchecked songs across rebuilds/refreshes.
  const { results: excludedRows } = await db
    .prepare(
      "SELECT artist_id, normalized_title FROM songs WHERE show_id = ? AND included = 0",
    )
    .bind(show.id)
    .all<{ artist_id: number; normalized_title: string }>();
  const excluded = new Set(
    excludedRows.map((r) => `${r.artist_id}|${r.normalized_title}`),
  );

  // Rebuild lineup + songs for this show.
  await db.prepare("DELETE FROM songs WHERE show_id = ?").bind(show.id).run();
  await db.prepare("DELETE FROM show_artists WHERE show_id = ?").bind(show.id).run();

  const mode = input.mode ?? "last_show";
  const results: BandResult[] = [];
  for (const [i, band] of bands.entries()) {
    if (i > 0 && input.delayMs) {
      await new Promise((r) => setTimeout(r, input.delayMs));
    }
    const artistId = (bandRefs[i] as { id: number }).id;
    let setlist: Awaited<ReturnType<typeof getMostRecentSetlist>>;
    let probabilities = new Map<string, number>();
    if (mode === "actual") {
      setlist = await getSetlistOnDate(band, date, keys.setlistfm);
    } else if (mode === "predicted") {
      const recent = await getRecentSetlists(band, date, keys.setlistfm, 5);
      const predicted = predictSetlist(recent);
      const latest = recent[0] ?? null;
      probabilities = new Map(predicted.map((p) => [normalizeName(p.title), p.probability]));
      setlist = latest && predicted.length > 0 ? { ...latest, songs: predicted } : latest;
    } else {
      setlist = await getMostRecentSetlist(band, date, keys.setlistfm);
    }
    await db
      .prepare(
        `INSERT INTO show_artists
           (show_id, artist_id, position, is_headliner, source_mode,
            source_setlist_id, source_setlist_date, source_setlist_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        show.id,
        artistId,
        i + 1,
        i === bands.length - 1 ? 1 : 0,
        mode,
        setlist?.setlistId || null,
        setlist?.date || null,
        setlist?.url || null,
      )
      .run();
    if (setlist && setlist.songs.length > 0) {
      // One D1 batch per band keeps Worker subrequest counts sane.
      await db.batch(
        setlist.songs.map((song, j) =>
          db
            .prepare(
              `INSERT INTO songs
                 (show_id, artist_id, position, title, normalized_title,
                  original_artist, is_tape, probability, included)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              show.id,
              artistId,
              j + 1,
              song.title,
              normalizeName(song.title),
              song.originalArtist,
              song.tape ? 1 : 0,
              probabilities.get(normalizeName(song.title)) ?? null,
              excluded.has(`${artistId}|${normalizeName(song.title)}`) ? 0 : 1,
            ),
        ),
      );
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
