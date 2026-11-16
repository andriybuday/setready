import { isoDatePlus } from "./automation";
import { normalizeName } from "./normalize";
import { publishTourToYouTube } from "./publish";
import { publishTourToSpotify } from "./publishSpotify";
import { getRecentSetlists, parseSetlistDate } from "./setlistfm";
import { buildShow } from "./shows";
import { getMusicEvents, type TourEvent } from "./ticketmaster";
import { importTourStops, lineupFingerprint } from "./tours";

export interface CandidateGroup {
  key: string;
  headliner: string;
  tourName: string;
  bandsPlayingOrder: string[];
  events: TourEvent[];
  countries: Set<string>;
  score: number;
}

function tourNameFromEvent(e: TourEvent): string {
  const headliner = e.billing[0] ?? "";
  for (const sep of [": ", " - "]) {
    if (e.eventName.toLowerCase().startsWith(headliner.toLowerCase() + sep)) {
      return e.eventName.slice(headliner.length + sep.length).trim();
    }
  }
  return "";
}

/** Group enumerated events into prospective tours (headliner + band set). */
export function groupCandidates(events: TourEvent[]): CandidateGroup[] {
  const groups = new Map<string, CandidateGroup>();
  for (const e of events) {
    const headliner = e.billing[0] ?? "";
    if (!headliner) continue;
    const key = `${normalizeName(headliner)}|${lineupFingerprint(e.billing)}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key, headliner, tourName: "", bandsPlayingOrder: e.lineup,
        events: [], countries: new Set(), score: 0,
      };
      groups.set(key, g);
    }
    g.events.push(e);
    if (e.country) g.countries.add(e.country);
    if (!g.tourName) g.tourName = tourNameFromEvent(e);
    if (e.lineup.length > g.bandsPlayingOrder.length) g.bandsPlayingOrder = e.lineup;
  }
  for (const g of groups.values()) {
    g.events.sort((a, b) => a.eventDate.localeCompare(b.eventDate));
    g.score =
      g.events.length * 10 + g.countries.size * 3 + Math.min(g.bandsPlayingOrder.length, 4) * 2;
  }
  return [...groups.values()].sort((a, b) => b.score - a.score);
}

export interface DiscoverySummary {
  window: [string, string];
  events: number;
  candidates: number;
  stored: number;
}

export async function discoverCandidates(
  db: D1Database,
  ticketmasterKey: string,
  today: string,
  windowDays = 14,
): Promise<DiscoverySummary> {
  const end = isoDatePlus(today, windowDays);
  const events = await getMusicEvents(today, end, ticketmasterKey);
  const groups = groupCandidates(events);
  const statements: D1PreparedStatement[] = [];
  for (const g of groups) {
    if (g.events.length < 2) continue; // a tour has repeat dates
    const first = g.events[0]?.eventDate as string;
    const last = g.events[g.events.length - 1]?.eventDate as string;
    statements.push(db
      .prepare(
        `INSERT INTO tour_candidates
           (candidate_key, headliner, tour_name, bands_json, first_date,
            last_date, events_count, countries_count, score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(candidate_key) DO UPDATE SET
           tour_name = CASE WHEN excluded.tour_name <> '' THEN excluded.tour_name ELSE tour_name END,
           bands_json = excluded.bands_json,
           first_date = excluded.first_date, last_date = excluded.last_date,
           events_count = excluded.events_count,
           countries_count = excluded.countries_count,
           score = excluded.score, updated_at = datetime('now')
         WHERE status = 'discovered'`,
      )
      .bind(
        g.key, g.headliner, g.tourName, JSON.stringify(g.bandsPlayingOrder),
        first, last, g.events.length, g.countries.size, g.score,
      ));
  }
  // Chunk batches to stay well inside D1/Worker limits
  for (let i = 0; i < statements.length; i += 50) {
    await db.batch(statements.slice(i, i + 50));
  }
  const stored = statements.length;
  return { window: [today, end], events: events.length, candidates: groups.length, stored };
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/** Setlist evidence: headliner needs recent shows; supports need any. */
export async function qualifyCandidate(
  bands: string[],
  firstDate: string,
  setlistfmKey: string,
): Promise<{ ok: boolean; reason: string }> {
  const headliner = bands[bands.length - 1] as string;
  const recent = await getRecentSetlists(headliner, firstDate, setlistfmKey, 5);
  const fresh = recent.filter((s) => {
    const d = parseSetlistDate(s.date);
    if (!d) return false;
    const iso = `${String(d).slice(0, 4)}-${String(d).slice(4, 6)}-${String(d).slice(6, 8)}`;
    return daysBetween(iso, firstDate) <= 365;
  });
  if (fresh.length < 2) {
    return { ok: false, reason: `headliner has ${fresh.length} setlists in last year (need >=2)` };
  }
  for (const support of bands.slice(0, -1)) {
    const any = await getRecentSetlists(support, firstDate, setlistfmKey, 1);
    if (any.length === 0) return { ok: false, reason: `no setlist found for support ${support}` };
  }
  return { ok: true, reason: `headliner ${fresh.length} recent setlists; supports covered` };
}

export interface PipelineSummary {
  discovery: DiscoverySummary;
  qualified: string[];
  rejected: Array<{ headliner: string; reason: string }>;
  published: Array<{ headliner: string; tourSlug: string; youtube?: string; spotify?: string }>;
  errors: Array<{ headliner: string; error: string }>;
}

/**
 * One capped pipeline pass: discover -> qualify up to `qualifyLimit`
 * fresh candidates -> build+publish up to `publishLimit` tours.
 */
export async function runPipeline(
  db: D1Database,
  keys: {
    setlistfm: string;
    ticketmaster?: string;
    googleClientId?: string;
    googleClientSecret?: string;
    spotifyClientId?: string;
    spotifyClientSecret?: string;
  },
  today = new Date().toISOString().slice(0, 10),
  options: {
    windowDays?: number; qualifyLimit?: number; publishLimit?: number;
    stage?: "full" | "discover" | "qualify" | "publish" | "tick";
  } = {},
): Promise<PipelineSummary> {
  if (!keys.ticketmaster) throw new Error("ticketmaster_not_configured");
  let stage = options.stage ?? "full";
  const fromTick = stage === "tick";
  if (stage === "tick") {
    const counts = await db
      .prepare("SELECT status, COUNT(*) AS n FROM tour_candidates GROUP BY status")
      .all<{ status: string; n: number }>();
    const byStatus = new Map(counts.results.map((r) => [r.status, r.n]));
    stage = (byStatus.get("qualified") ?? 0) > 0
      ? "publish"
      : (byStatus.get("discovered") ?? 0) > 0
        ? "qualify"
        : "discover";
  }
  const summary: PipelineSummary = {
    discovery: stage === "full" || stage === "discover"
      ? await discoverCandidates(db, keys.ticketmaster, today, options.windowDays ?? 14)
      : { window: [today, today], events: 0, candidates: 0, stored: 0 },
    qualified: [], rejected: [], published: [], errors: [],
  };
  if (stage === "discover") return summary;

  const fresh = stage === "publish" ? [] : (await db
    .prepare(
      `SELECT id, headliner, bands_json, first_date FROM tour_candidates
        WHERE status = 'discovered' ORDER BY score DESC LIMIT ?`,
    )
    .bind(options.qualifyLimit ?? 10)
    .all<{ id: number; headliner: string; bands_json: string; first_date: string }>()).results;

  for (const c of fresh) {
    await new Promise((r) => setTimeout(r, 700));
    try {
      const bands = JSON.parse(c.bands_json) as string[];
      const verdict = await qualifyCandidate(bands, c.first_date, keys.setlistfm);
      await db
        .prepare("UPDATE tour_candidates SET status = ?, reason = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(verdict.ok ? "qualified" : "rejected", verdict.reason, c.id)
        .run();
      if (verdict.ok) summary.qualified.push(c.headliner);
      else summary.rejected.push({ headliner: c.headliner, reason: verdict.reason });
    } catch (err) {
      summary.errors.push({ headliner: c.headliner, error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    }
  }

  if (stage === "qualify") return summary;
  let publishLimit = options.publishLimit ?? 1;
  if (fromTick) {
    // Automated ticks may fire every 15 minutes; cap total automated
    // publishes to 2 tours/day to stay inside YouTube quota/search limits.
    const row = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM tour_candidates WHERE status = 'published' AND date(updated_at) = date('now')",
      )
      .first<{ n: number }>();
    publishLimit = Math.min(publishLimit, Math.max(0, 2 - (row?.n ?? 0)));
  }
  if (publishLimit <= 0) return summary;
  const { results: ready } = await db
    .prepare(
      `SELECT id, headliner, tour_name, bands_json, first_date FROM tour_candidates
        WHERE status = 'qualified' ORDER BY score DESC LIMIT ?`,
    )
    .bind(publishLimit)
    .all<{ id: number; headliner: string; tour_name: string; bands_json: string; first_date: string }>();

  for (const c of ready) {
    try {
      const bands = JSON.parse(c.bands_json) as string[];
      const built = await buildShow(
        db,
        { headliner: c.headliner, date: c.first_date, bands, mode: "predicted", delayMs: 550 },
        keys,
      );
      // Import the full itinerary before publishing so descriptions
      // carry every stop, not just the representative built show.
      const tourForImport = await db.prepare("SELECT id FROM tours WHERE slug = ?")
        .bind(built.tourSlug).first<{ id: number }>();
      if (tourForImport && keys.ticketmaster) {
        await importTourStops(db, tourForImport.id, keys.ticketmaster);
      }
      const out: { headliner: string; tourSlug: string; youtube?: string; spotify?: string } = {
        headliner: c.headliner, tourSlug: built.tourSlug,
      };
      let ytAdded = 0, spAdded = 0, totalSongs = 0;
      if (keys.googleClientId && keys.googleClientSecret) {
        const r = await publishTourToYouTube(db, built.tourSlug, keys.googleClientId, keys.googleClientSecret);
        out.youtube = r.youtubeMusic; ytAdded = r.added; totalSongs = r.added + r.unmatched.length + r.failed.length;
      }
      if (keys.spotifyClientId && keys.spotifyClientSecret) {
        const r = await publishTourToSpotify(db, built.tourSlug, keys.spotifyClientId, keys.spotifyClientSecret);
        out.spotify = r.spotify; spAdded = r.added; totalSongs = Math.max(totalSongs, r.added + r.unmatched.length + r.failed.length);
      }
      const tourRow = await db.prepare("SELECT id FROM tours WHERE slug = ?")
        .bind(built.tourSlug).first<{ id: number }>();
      const ratio = totalSongs ? Math.max(ytAdded, spAdded) / totalSongs : 0;
      await db
        .prepare(
          "UPDATE tour_candidates SET status = 'published', tour_id = ?, show_slug = ?, reason = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .bind(tourRow?.id ?? null, built.slug, `match ratio ${ratio.toFixed(2)}`, c.id)
        .run();
      summary.published.push(out);
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 200) : String(err);
      await db.prepare(
        "UPDATE tour_candidates SET status = 'failed', reason = ?, updated_at = datetime('now') WHERE id = ?",
      ).bind(message, c.id).run();
      summary.errors.push({ headliner: c.headliner, error: message });
    }
  }
  return summary;
}
