import { normalizeName } from "./normalize";
import { matchArtist, publishableSongs, type ShowSongRow } from "./publish";

/** Automated publishing may spend at most this many YouTube searches per Pacific day. */
export const AUTOMATED_YT_SEARCH_BUDGET = 80;

export function pacificDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export interface QuotaState {
  pacificDate: string;
  searchUsed: number;
  unitsUsed: number;
  toursPublished: number;
  automatedSearchBudget: number;
  automatedSearchRemaining: number;
}

export async function getQuotaState(db: D1Database, now = new Date()): Promise<QuotaState> {
  const date = pacificDate(now);
  const row = await db
    .prepare(
      "SELECT search_used, units_used, tours_published FROM youtube_quota_ledger WHERE pacific_date = ?",
    )
    .bind(date)
    .first<{ search_used: number; units_used: number; tours_published: number }>();
  const searchUsed = row?.search_used ?? 0;
  return {
    pacificDate: date,
    searchUsed,
    unitsUsed: row?.units_used ?? 0,
    toursPublished: row?.tours_published ?? 0,
    automatedSearchBudget: AUTOMATED_YT_SEARCH_BUDGET,
    automatedSearchRemaining: Math.max(0, AUTOMATED_YT_SEARCH_BUDGET - searchUsed),
  };
}

export async function recordYouTubeUsage(
  db: D1Database,
  usage: { searches: number; units: number; tourPublished?: boolean },
  now = new Date(),
): Promise<void> {
  const date = pacificDate(now);
  await db
    .prepare(
      `INSERT INTO youtube_quota_ledger
         (pacific_date, search_used, units_used, tours_published)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(pacific_date) DO UPDATE SET
         search_used = search_used + excluded.search_used,
         units_used = units_used + excluded.units_used,
         tours_published = tours_published + excluded.tours_published,
         updated_at = datetime('now')`,
    )
    .bind(date, Math.max(0, usage.searches), Math.max(0, usage.units), usage.tourPublished ? 1 : 0)
    .run();
}

/** Songs in a built show that would require a fresh YouTube search. */
export async function estimateYouTubeSearches(db: D1Database, showSlug: string): Promise<number> {
  const show = await db.prepare("SELECT id FROM shows WHERE slug = ?")
    .bind(showSlug).first<{ id: number }>();
  if (!show) return 0;
  const { results } = await db
    .prepare(
      `SELECT a.name AS artist_name, s.title, s.normalized_title,
              s.original_artist, s.is_tape, s.included
         FROM songs s
         JOIN artists a ON a.id = s.artist_id
        WHERE s.show_id = ?`,
    )
    .bind(show.id)
    .all<ShowSongRow>();
  const songs = publishableSongs(results);
  let estimate = 0;
  for (const song of songs) {
    const artistNorm = normalizeName(matchArtist(song));
    const cached = await db
      .prepare(
        `SELECT status FROM track_matches
          WHERE service = 'youtube' AND artist_normalized = ? AND title_normalized = ?`,
      )
      .bind(artistNorm, song.normalized_title)
      .first<{ status: string }>();
    if (!cached) estimate += 1;
  }
  return estimate;
}

export function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /HTTP 429|quota/i.test(msg);
}
