import { normalizeName } from "./normalize";

/** Stable fingerprint of a band *set* (order-independent). */
export function lineupFingerprint(bands: string[]): string {
  const key = bands.map(normalizeName).sort().join("|");
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36).padStart(6, "0").slice(-6);
}

export function tourSlug(
  tourName: string,
  headliner: string,
  year: string,
  bands: string[],
): string {
  const base = normalizeName(tourName || headliner).replace(/\s+/g, "-");
  return `${base}-${year}-${lineupFingerprint(bands)}`;
}

export interface TourArtistRef {
  id: number;
  name: string;
}

export async function upsertTour(
  db: D1Database,
  input: {
    tourName: string;
    title: string;
    headliner: TourArtistRef;
    bands: TourArtistRef[]; // playing order
    year: string;
  },
): Promise<{ id: number; slug: string }> {
  const bandNames = input.bands.map((b) => b.name);
  const fingerprint = lineupFingerprint(bandNames);
  // Same headliner + same band set is the same tour even when one
  // Ticketmaster event lacks the tour name; prefer the named record.
  const existing = await db
    .prepare(
      `SELECT id, slug, tour_name, title FROM tours
        WHERE lineup_fingerprint = ? AND headliner_artist_id = ?
        ORDER BY (tour_name <> '') DESC, id LIMIT 1`,
    )
    .bind(fingerprint, input.headliner.id)
    .first<{ id: number; slug: string; tour_name: string; title: string }>();

  let slug: string;
  if (existing) {
    slug = existing.slug;
    await db
      .prepare(
        `UPDATE tours SET
           tour_name = CASE WHEN ? <> '' THEN ? ELSE tour_name END,
           title = CASE WHEN ? <> '' THEN ? ELSE title END,
           updated_at = datetime('now')
         WHERE id = ?`,
      )
      .bind(input.tourName, input.tourName, input.tourName, input.title, existing.id)
      .run();
  } else {
    slug = tourSlug(input.tourName, input.headliner.name, input.year, bandNames);
    await db
      .prepare(
        `INSERT INTO tours (slug, tour_name, title, headliner_artist_id, lineup_fingerprint)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(slug, input.tourName, input.title, input.headliner.id, fingerprint)
      .run();
  }
  const tour = await db
    .prepare("SELECT id FROM tours WHERE slug = ?")
    .bind(slug)
    .first<{ id: number }>();
  if (!tour) throw new Error("tour upsert failed");

  await db.prepare("DELETE FROM tour_artists WHERE tour_id = ?").bind(tour.id).run();
  for (const [i, band] of input.bands.entries()) {
    await db
      .prepare(
        `INSERT INTO tour_artists (tour_id, artist_id, position, is_headliner)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(tour.id, band.id, i + 1, i === input.bands.length - 1 ? 1 : 0)
      .run();
  }
  return { id: tour.id, slug };
}

export interface TourStop {
  slug: string;
  event_date: string;
  venue: string | null;
}

export async function listTourStops(db: D1Database, tourId: number): Promise<TourStop[]> {
  const { results } = await db
    .prepare(
      `SELECT slug, event_date, venue FROM shows
        WHERE tour_id = ? ORDER BY event_date, slug`,
    )
    .bind(tourId)
    .all<TourStop>();
  return results;
}
