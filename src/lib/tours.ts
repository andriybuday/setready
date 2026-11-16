import { normalizeName } from "./normalize";
import { getTourEvents, type TourEvent } from "./ticketmaster";

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
  city: string | null;
  confidence: "confirmed" | "inferred";
}

export interface ClassifiedStop extends TourEvent {
  confidence: "confirmed" | "inferred";
}

/**
 * Assign enumerated tour events to one lineup: exact band-set matches
 * are confirmed; sparse listings (subset of the lineup, headliner
 * present) inside the confirmed date range are inferred. Everything
 * else belongs to another leg/lineup and is excluded.
 */
export function classifyTourStops(
  events: TourEvent[],
  tourBands: string[],
  headliner: string,
): ClassifiedStop[] {
  const wanted = new Set(tourBands.map(normalizeName));
  const headlinerNorm = normalizeName(headliner);
  const isExact = (e: TourEvent) => {
    const set = new Set(e.lineup.map(normalizeName));
    return set.size === wanted.size && [...wanted].every((b) => set.has(b));
  };
  const confirmed = events.filter(isExact);
  if (confirmed.length === 0) return [];
  const dates = confirmed.map((e) => e.eventDate).sort();
  const first = dates[0] as string;
  const last = dates[dates.length - 1] as string;
  const out: ClassifiedStop[] = confirmed.map((e) => ({ ...e, confidence: "confirmed" }));
  for (const e of events) {
    if (isExact(e)) continue;
    if (e.eventDate < first || e.eventDate > last) continue;
    const set = new Set(e.lineup.map(normalizeName));
    if (!set.has(headlinerNorm)) continue;
    if (![...set].every((b) => wanted.has(b))) continue;
    out.push({ ...e, confidence: "inferred" });
  }
  return out.sort((a, b) => a.eventDate.localeCompare(b.eventDate));
}

/** Import/refresh this tour's stop list from Ticketmaster. */
export async function importTourStops(
  db: D1Database,
  tourId: number,
  ticketmasterKey: string,
): Promise<{ imported: number; confirmed: number; inferred: number }> {
  const { results: bandRows } = await db
    .prepare(
      `SELECT a.name, ta.is_headliner FROM tour_artists ta
        JOIN artists a ON a.id = ta.artist_id
       WHERE ta.tour_id = ? ORDER BY ta.position`,
    )
    .bind(tourId)
    .all<{ name: string; is_headliner: number }>();
  if (bandRows.length === 0) throw new Error("tour has no lineup");
  const headliner = (bandRows.find((b) => b.is_headliner === 1) ?? bandRows[bandRows.length - 1])?.name as string;
  const bands = bandRows.map((b) => b.name);
  const events = await getTourEvents(headliner, ticketmasterKey);
  const stops = classifyTourStops(events, bands, headliner);
  await db.batch(stops.map((s) => db
      .prepare(
        `INSERT INTO tour_stops
           (tour_id, event_date, venue, city, region, country,
            ticketmaster_event_id, lineup_json, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tour_id, event_date, city) DO UPDATE SET
           venue = excluded.venue, region = excluded.region,
           country = excluded.country,
           ticketmaster_event_id = excluded.ticketmaster_event_id,
           lineup_json = excluded.lineup_json,
           confidence = excluded.confidence,
           updated_at = datetime('now')`,
      )
      .bind(
        tourId,
        s.eventDate,
        s.venue || null,
        s.city || null,
        s.region || null,
        s.country || null,
        s.ticketmasterEventId || null,
        JSON.stringify(s.lineup),
        s.confidence,
      )));
  return {
    imported: stops.length,
    confirmed: stops.filter((s) => s.confidence === "confirmed").length,
    inferred: stops.filter((s) => s.confidence === "inferred").length,
  };
}

/**
 * Canonical stop list for descriptions: imported tour stops merged
 * with built shows (which may include past dates no longer returned
 * by Ticketmaster), deduplicated by date.
 */
export async function listTourStops(db: D1Database, tourId: number): Promise<TourStop[]> {
  const { results: imported } = await db
    .prepare(
      `SELECT ticketmaster_event_id AS slug, event_date, venue, city, confidence
         FROM tour_stops WHERE tour_id = ? ORDER BY event_date`,
    )
    .bind(tourId)
    .all<TourStop>();
  const { results: built } = await db
    .prepare(
      `SELECT slug, event_date, venue, city, 'confirmed' AS confidence
         FROM shows WHERE tour_id = ? ORDER BY event_date, slug`,
    )
    .bind(tourId)
    .all<TourStop>();
  const byDate = new Map<string, TourStop>();
  for (const s of built) byDate.set(s.event_date, { ...s, confidence: "confirmed" });
  for (const s of imported) byDate.set(s.event_date, s);
  return [...byDate.values()].sort((a, b) => a.event_date.localeCompare(b.event_date));
}
