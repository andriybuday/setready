import { normalizeName } from "./normalize";
import { publishTourToYouTube } from "./publish";
import { publishTourToSpotify } from "./publishSpotify";
import { buildShow, type BuildMode } from "./shows";
import { syncTourDescriptions } from "./syncDescriptions";
import { importTourStops } from "./tours";

export function tracklistHash(entries: Array<{ artist: string; title: string }>): string {
  const key = entries
    .map((e) => `${normalizeName(e.artist)}|${normalizeName(e.title)}`)
    .join(">");
  let hash = 5381;
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

export function isoDatePlus(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y as number, (m as number) - 1, d as number) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

interface ShowRow {
  id: number;
  slug: string;
  event_date: string;
  status: string;
  tour_id: number | null;
  tour_slug: string | null;
  headliner: string;
  mode: string | null;
}

async function loadShows(db: D1Database, where: string, binds: unknown[]): Promise<ShowRow[]> {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.slug, s.event_date, s.status, s.tour_id,
              t.slug AS tour_slug,
              (SELECT a.name FROM show_artists sa JOIN artists a ON a.id = sa.artist_id
                WHERE sa.show_id = s.id ORDER BY sa.position DESC LIMIT 1) AS headliner,
              (SELECT source_mode FROM show_artists
                WHERE show_id = s.id ORDER BY position LIMIT 1) AS mode
         FROM shows s LEFT JOIN tours t ON t.id = s.tour_id
        WHERE ${where}
        ORDER BY s.event_date`,
    )
    .bind(...binds)
    .all<ShowRow>();
  return results;
}

async function bandsForShow(db: D1Database, showId: number): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT a.name FROM show_artists sa JOIN artists a ON a.id = sa.artist_id
        WHERE sa.show_id = ? ORDER BY sa.position`,
    )
    .bind(showId)
    .all<{ name: string }>();
  return results.map((r) => r.name);
}

async function currentTracklistHash(db: D1Database, showId: number): Promise<string> {
  const { results } = await db
    .prepare(
      `SELECT a.name AS artist, s.title FROM songs s
        JOIN artists a ON a.id = s.artist_id
        JOIN show_artists sa ON sa.show_id = s.show_id AND sa.artist_id = s.artist_id
       WHERE s.show_id = ? AND s.included = 1 AND s.is_tape = 0
       ORDER BY sa.position, s.position`,
    )
    .bind(showId)
    .all<{ artist: string; title: string }>();
  return tracklistHash(results);
}

export interface AutomationSummary {
  date: string;
  refreshed: string[];
  frozen: string[];
  actualized: string[];
  republishedTours: string[];
  importedStopsFor: string[];
  errors: Array<{ slug: string; error: string }>;
}

/**
 * Daily automation:
 * - refresh upcoming predicted shows (next 30 days) from latest setlists
 * - freeze today's shows after their final refresh
 * - for shows in the last 7 days still frozen, swap in the exact actual
 *   setlist once it appears on setlist.fm
 * - refresh tour stop imports; republish only tours that already have a
 *   playlist and whose tracklist actually changed
 */
export async function runDailyAutomation(
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
): Promise<AutomationSummary> {
  const summary: AutomationSummary = {
    date: today, refreshed: [], frozen: [], actualized: [],
    republishedTours: [], importedStopsFor: [], errors: [],
  };
  const guard = async (slug: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (err) {
      summary.errors.push({ slug, error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    }
  };

  const upcoming = await loadShows(
    db,
    "s.status = 'predicted' AND s.event_date >= ? AND s.event_date <= ?",
    [today, isoDatePlus(today, 30)],
  );
  const touchedTours = new Map<string, number>();

  for (const show of upcoming) {
    await guard(show.slug, async () => {
      const bands = await bandsForShow(db, show.id);
      const mode: BuildMode =
        show.mode === "predicted" || show.mode === "actual" ? show.mode : "last_show";
      await buildShow(
        db,
        { headliner: show.headliner, date: show.event_date, bands, mode, status: "predicted", delayMs: 550 },
        keys,
      );
      summary.refreshed.push(show.slug);
      if (show.tour_id && show.tour_slug) touchedTours.set(show.tour_slug, show.tour_id);
      if (show.event_date === today) {
        await db.prepare("UPDATE shows SET status = 'frozen', updated_at = datetime('now') WHERE id = ?")
          .bind(show.id).run();
        summary.frozen.push(show.slug);
      }
    });
  }

  const recent = await loadShows(
    db,
    "s.status IN ('frozen','predicted') AND s.event_date < ? AND s.event_date >= ?",
    [today, isoDatePlus(today, -7)],
  );
  for (const show of recent) {
    await guard(show.slug, async () => {
      const bands = await bandsForShow(db, show.id);
      const built = await buildShow(
        db,
        { headliner: show.headliner, date: show.event_date, bands, mode: "actual", status: "actual", delayMs: 550 },
        keys,
      );
      const headlinerGotActual = built.bands[built.bands.length - 1]?.setlist != null;
      if (!headlinerGotActual) {
        // Actual setlist not posted yet; restore frozen status for retry.
        await db.prepare("UPDATE shows SET status = 'frozen' WHERE id = ?").bind(show.id).run();
        return;
      }
      summary.actualized.push(show.slug);
      if (show.tour_id && show.tour_slug) touchedTours.set(show.tour_slug, show.tour_id);
    });
  }

  for (const [tourSlug, tourId] of touchedTours) {
    await guard(tourSlug, async () => {
      if (keys.ticketmaster) {
        await importTourStops(db, tourId, keys.ticketmaster);
        summary.importedStopsFor.push(tourSlug);
      }
      // Only republish services that already have a canonical playlist,
      // and only when the representative tracklist changed.
      const { results: published } = await db
        .prepare("SELECT DISTINCT service FROM published_playlists WHERE tour_id = ?")
        .bind(tourId)
        .all<{ service: string }>();
      if (published.length === 0) return;
      const rep = await db
        .prepare("SELECT id FROM shows WHERE tour_id = ? ORDER BY updated_at DESC, event_date DESC LIMIT 1")
        .bind(tourId)
        .first<{ id: number }>();
      if (!rep) return;
      const hash = await currentTracklistHash(db, rep.id);
      const tourRow = await db
        .prepare("SELECT last_published_hash FROM tours WHERE id = ?")
        .bind(tourId)
        .first<{ last_published_hash: string | null }>();
      await db.prepare("UPDATE tours SET last_refreshed_at = datetime('now') WHERE id = ?").bind(tourId).run();
      if (tourRow?.last_published_hash === hash) return;
      for (const p of published) {
        if (p.service === "youtube" && keys.googleClientId && keys.googleClientSecret) {
          await publishTourToYouTube(db, tourSlug, keys.googleClientId, keys.googleClientSecret);
        } else if (p.service === "spotify" && keys.spotifyClientId && keys.spotifyClientSecret) {
          await publishTourToSpotify(db, tourSlug, keys.spotifyClientId, keys.spotifyClientSecret);
        }
      }
      await db.prepare("UPDATE tours SET last_published_hash = ? WHERE id = ?").bind(hash, tourId).run();
      summary.republishedTours.push(tourSlug);
    });
  }

  return summary;
}

/** Weekly: refresh titles/descriptions on published tours (capped). */
export async function syncPublishedTourDescriptions(
  db: D1Database,
  creds: {
    googleClientId: string; googleClientSecret: string;
    spotifyClientId: string; spotifyClientSecret: string;
  },
  limit = 10,
): Promise<{ synced: string[]; errors: Array<{ slug: string; error: string }> }> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT t.slug FROM tours t
        JOIN published_playlists p ON p.tour_id = t.id
       ORDER BY t.updated_at LIMIT ?`,
    )
    .bind(limit)
    .all<{ slug: string }>();
  const synced: string[] = [];
  const errors: Array<{ slug: string; error: string }> = [];
  for (const row of results) {
    try {
      await syncTourDescriptions(db, row.slug, creds);
      synced.push(row.slug);
    } catch (err) {
      errors.push({ slug: row.slug, error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    }
  }
  return { synced, errors };
}
