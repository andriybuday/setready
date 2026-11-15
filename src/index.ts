import { authorizeAdmin, requiresAdmin } from "./lib/auth";
import type { Env } from "./env";
import { publishShowToYouTube, publishTourToYouTube } from "./lib/publish";
import { publishShowToSpotify, publishTourToSpotify } from "./lib/publishSpotify";
import { syncTourDescriptions } from "./lib/syncDescriptions";
import { importTourStops, listTourStops } from "./lib/tours";
import { getMostRecentSetlist, searchArtists } from "./lib/setlistfm";
import { buildShow } from "./lib/shows";
import { homePage, showPage } from "./ui";
import * as spotify from "./lib/spotify";
import { getLineup } from "./lib/ticketmaster";
import {
  accessTokenFromRefresh,
  addPlaylistItem,
  createPlaylist,
  exchangeCode,
  musicPlaylistUrl,
  playlistUrl,
  searchFirstVideo,
  youtubeAuthUrl,
} from "./lib/youtube";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

interface ShowRow {
  slug: string;
  title: string;
  venue: string | null;
  city: string | null;
  event_date: string;
  status: string;
}

async function handle(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (requiresAdmin(request)) {
      const auth = authorizeAdmin(request, env.ADMIN_TOKEN);
      if (!auth.ok) return json({ error: auth.error }, auth.status);
    }

    if (url.pathname === "/health") {
      // Proves the D1 binding + migrations are live without leaking secrets.
      const row = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'",
      ).first<{ n: number }>();
      return json({
        ok: true,
        service: "setready",
        configured: {
          setlistfm: Boolean(env.SETLISTFM_API_KEY),
          ticketmaster: Boolean(env.TICKETMASTER_API_KEY),
          googleCloudProject: env.GOOGLE_CLOUD_PROJECT ?? null,
        },
        databaseTables: row?.n ?? 0,
      });
    }

    // --- YouTube publisher OAuth (one-time consent for the SetReady channel)
    if (url.pathname === "/oauth/youtube/start") {
      if (!env.GOOGLE_OAUTH_CLIENT_ID) {
        return json({ error: "google_oauth_not_configured" }, 503);
      }
      const redirectUri = `${url.origin}/oauth/youtube/callback`;
      return Response.redirect(
        youtubeAuthUrl(env.GOOGLE_OAUTH_CLIENT_ID, redirectUri),
        302,
      );
    }

    if (url.pathname === "/oauth/youtube/callback") {
      const code = url.searchParams.get("code");
      if (!code || !env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
        return json({ error: "missing_code_or_client_config" }, 400);
      }
      const redirectUri = `${url.origin}/oauth/youtube/callback`;
      const tokens = await exchangeCode(
        code,
        env.GOOGLE_OAUTH_CLIENT_ID,
        env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirectUri,
      );
      if (!tokens.refresh_token) {
        return json(
          { error: "no_refresh_token", hint: "revoke prior consent and retry" },
          400,
        );
      }
      await env.DB.prepare(
        `INSERT INTO oauth_credentials (service, refresh_token, scope)
         VALUES ('youtube', ?, ?)
         ON CONFLICT(service) DO UPDATE SET
           refresh_token = excluded.refresh_token,
           scope = excluded.scope,
           updated_at = datetime('now')`,
      )
        .bind(tokens.refresh_token, tokens.scope ?? null)
        .run();
      return json({
        ok: true,
        message: "YouTube publisher connected. Now POST /api/youtube/spike",
      });
    }

    // Phase 0 spike: public test playlist with one song, to verify the
    // playlist surfaces in YouTube Music. Costs ~100 quota units + 1 search.
    if (url.pathname === "/api/youtube/spike" && request.method === "POST") {
      if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
        return json({ error: "google_oauth_not_configured" }, 503);
      }
      const cred = await env.DB.prepare(
        "SELECT refresh_token FROM oauth_credentials WHERE service = 'youtube'",
      ).first<{ refresh_token: string }>();
      if (!cred) {
        return json({ error: "publisher_not_connected", start: "/oauth/youtube/start" }, 409);
      }
      const accessToken = await accessTokenFromRefresh(
        cred.refresh_token,
        env.GOOGLE_OAUTH_CLIENT_ID,
        env.GOOGLE_OAUTH_CLIENT_SECRET,
      );
      const playlist = await createPlaylist(
        accessToken,
        "SetReady spike test",
        "Phase 0 verification playlist (safe to delete).",
      );
      const hit = await searchFirstVideo(accessToken, "Metallica Creeping Death official audio");
      if (hit) {
        await addPlaylistItem(accessToken, playlist.id, hit.videoId);
      }
      return json({
        ok: true,
        playlistId: playlist.id,
        youtube: playlistUrl(playlist.id),
        youtubeMusic: musicPlaylistUrl(playlist.id),
        added: hit,
      });
    }

    // --- Spotify publisher OAuth (one-time consent for the SetReady account)
    if (url.pathname === "/oauth/spotify/start") {
      if (!env.SPOTIFY_CLIENT_ID) return json({ error: "spotify_not_configured" }, 503);
      const redirectUri = `${url.origin}/oauth/spotify/callback`;
      return Response.redirect(spotify.spotifyAuthUrl(env.SPOTIFY_CLIENT_ID, redirectUri), 302);
    }

    if (url.pathname === "/oauth/spotify/callback") {
      const code = url.searchParams.get("code");
      if (!code || !env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
        return json({ error: "missing_code_or_client_config" }, 400);
      }
      const redirectUri = `${url.origin}/oauth/spotify/callback`;
      const tokens = await spotify.exchangeCode(
        code,
        env.SPOTIFY_CLIENT_ID,
        env.SPOTIFY_CLIENT_SECRET,
        redirectUri,
      );
      if (!tokens.refresh_token) return json({ error: "no_refresh_token" }, 400);
      await env.DB.prepare(
        `INSERT INTO oauth_credentials (service, refresh_token, scope)
         VALUES ('spotify', ?, ?)
         ON CONFLICT(service) DO UPDATE SET
           refresh_token = excluded.refresh_token,
           scope = excluded.scope,
           updated_at = datetime('now')`,
      )
        .bind(tokens.refresh_token, tokens.scope ?? null)
        .run();
      const me = await spotify.getMe(tokens.access_token);
      return json({
        ok: true,
        message: "Spotify publisher connected. Now POST /api/spotify/spike",
        account: me,
      });
    }

    // Phase 0 spike: public test playlist with one song on the SetReady account.
    if (url.pathname === "/api/spotify/spike" && request.method === "POST") {
      if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
        return json({ error: "spotify_not_configured" }, 503);
      }
      const cred = await env.DB.prepare(
        "SELECT refresh_token FROM oauth_credentials WHERE service = 'spotify'",
      ).first<{ refresh_token: string }>();
      if (!cred) {
        return json({ error: "publisher_not_connected", start: "/oauth/spotify/start" }, 409);
      }
      const { accessToken } = await spotify.accessTokenFromRefresh(
        cred.refresh_token,
        env.SPOTIFY_CLIENT_ID,
        env.SPOTIFY_CLIENT_SECRET,
      );
      const playlist = await spotify.createPlaylist(
        accessToken,
        "SetReady spike test",
        "Phase 0 verification playlist (safe to delete).",
      );
      const hit = await spotify.searchTrack(accessToken, "Metallica", "Creeping Death");
      if (hit) await spotify.addPlaylistItems(accessToken, playlist.id, [hit.uri]);
      return json({ ok: true, playlist, added: hit });
    }

    // --- Engine: recent setlist for one artist (engine stage 1)
    if (url.pathname === "/api/setlist") {
      const artist = url.searchParams.get("artist")?.trim();
      const date = url.searchParams.get("date")?.trim();
      if (!artist || !date) {
        return json({ error: "artist_and_date_required" }, 400);
      }
      const setlist = await getMostRecentSetlist(artist, date, env.SETLISTFM_API_KEY);
      if (!setlist) {
        const suggestions = await searchArtists(artist, env.SETLISTFM_API_KEY);
        return json({ artist, setlist: null, suggestions });
      }
      return json({ artist, setlist });
    }

    if (url.pathname === "/api/lineup") {
      const artist = url.searchParams.get("artist")?.trim();
      const date = url.searchParams.get("date")?.trim();
      if (!artist || !date) {
        return json({ error: "artist_and_date_required" }, 400);
      }
      if (!env.TICKETMASTER_API_KEY) {
        return json({ error: "ticketmaster_not_configured" }, 503);
      }
      const lineup = await getLineup(artist, date, env.TICKETMASTER_API_KEY);
      return json({ artist, lineup });
    }

    // Build a full show (lineup + setlists) into D1.
    // Body: { headliner, date, bands?[] }  (bands: support first)
    if (url.pathname === "/api/shows/build" && request.method === "POST") {
      const body = (await request.json()) as {
        headliner?: string;
        date?: string;
        bands?: string[];
      };
      if (!body.headliner || !body.date) {
        return json({ error: "headliner_and_date_required" }, 400);
      }
      const built = await buildShow(
        env.DB,
        { headliner: body.headliner, date: body.date, bands: body.bands },
        { setlistfm: env.SETLISTFM_API_KEY, ticketmaster: env.TICKETMASTER_API_KEY },
      );
      return json({
        slug: built.slug,
        title: built.title,
        venue: built.venue,
        tourName: built.tourName,
        tourSlug: built.tourSlug,
        eventDate: built.eventDate,
        bands: built.bands.map((b) => ({
          band: b.band,
          songs: b.setlist?.songs.length ?? 0,
          source: b.setlist
            ? { date: b.setlist.date, venue: b.setlist.venue, url: b.setlist.url }
            : null,
          suggestions: b.suggestions,
        })),
      });
    }

    const spotifyShowMatch = /^\/api\/shows\/([^/]+)\/publish\/spotify$/.exec(url.pathname);
    if (spotifyShowMatch && request.method === "POST") {
      if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
        return json({ error: "spotify_not_configured" }, 503);
      }
      const result = await publishShowToSpotify(
        env.DB,
        decodeURIComponent(spotifyShowMatch[1] as string),
        env.SPOTIFY_CLIENT_ID,
        env.SPOTIFY_CLIENT_SECRET,
      );
      return json({ ok: true, ...result });
    }

    // Publish a saved show as the canonical public YouTube/YTM playlist.
    const publishMatch = /^\/api\/shows\/([^/]+)\/publish\/youtube$/.exec(url.pathname);
    if (publishMatch && request.method === "POST") {
      if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
        return json({ error: "google_oauth_not_configured" }, 503);
      }
      const result = await publishShowToYouTube(
        env.DB,
        decodeURIComponent(publishMatch[1] as string),
        env.GOOGLE_OAUTH_CLIENT_ID,
        env.GOOGLE_OAUTH_CLIENT_SECRET,
      );
      return json({ ok: true, ...result });
    }

    const importStopsMatch = /^\/api\/tours\/([^/]+)\/import-stops$/.exec(url.pathname);
    if (importStopsMatch && request.method === "POST") {
      if (!env.TICKETMASTER_API_KEY) {
        return json({ error: "ticketmaster_not_configured" }, 503);
      }
      const tourSlug = decodeURIComponent(importStopsMatch[1] as string);
      const tour = await env.DB.prepare("SELECT id FROM tours WHERE slug = ?")
        .bind(tourSlug)
        .first<{ id: number }>();
      if (!tour) return json({ error: "tour_not_found" }, 404);
      const summary = await importTourStops(env.DB, tour.id, env.TICKETMASTER_API_KEY);
      return json({ ok: true, tourSlug, ...summary, stops: await listTourStops(env.DB, tour.id) });
    }

    const syncDescMatch = /^\/api\/tours\/([^/]+)\/sync-descriptions$/.exec(url.pathname);
    if (syncDescMatch && request.method === "POST") {
      if (
        !env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET ||
        !env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET
      ) {
        return json({ error: "publisher_credentials_not_configured" }, 503);
      }
      const result = await syncTourDescriptions(
        env.DB,
        decodeURIComponent(syncDescMatch[1] as string),
        {
          googleClientId: env.GOOGLE_OAUTH_CLIENT_ID,
          googleClientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
          spotifyClientId: env.SPOTIFY_CLIENT_ID,
          spotifyClientSecret: env.SPOTIFY_CLIENT_SECRET,
        },
      );
      return json({ ok: true, ...result });
    }

    const tourSpotifyMatch = /^\/api\/tours\/([^/]+)\/publish\/spotify$/.exec(url.pathname);
    if (tourSpotifyMatch && request.method === "POST") {
      if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
        return json({ error: "spotify_not_configured" }, 503);
      }
      const result = await publishTourToSpotify(
        env.DB,
        decodeURIComponent(tourSpotifyMatch[1] as string),
        env.SPOTIFY_CLIENT_ID,
        env.SPOTIFY_CLIENT_SECRET,
      );
      return json({ ok: true, ...result });
    }

    const tourPublishMatch = /^\/api\/tours\/([^/]+)\/publish\/youtube$/.exec(url.pathname);
    if (tourPublishMatch && request.method === "POST") {
      if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
        return json({ error: "google_oauth_not_configured" }, 503);
      }
      const result = await publishTourToYouTube(
        env.DB,
        decodeURIComponent(tourPublishMatch[1] as string),
        env.GOOGLE_OAUTH_CLIENT_ID,
        env.GOOGLE_OAUTH_CLIENT_SECRET,
      );
      return json({ ok: true, ...result });
    }

    const detailMatch = /^\/api\/shows\/([^/]+)$/.exec(url.pathname);
    if (detailMatch) {
      const slug = decodeURIComponent(detailMatch[1] as string);
      const show = await env.DB.prepare(
        `SELECT s.id, s.slug, s.title, s.venue, s.event_date, s.tour_name,
                s.status, s.tour_id, t.slug AS tour_slug
           FROM shows s LEFT JOIN tours t ON t.id = s.tour_id
          WHERE s.slug = ?`,
      )
        .bind(slug)
        .first<{
          id: number; slug: string; title: string; venue: string | null;
          event_date: string; tour_name: string | null; status: string;
          tour_id: number | null; tour_slug: string | null;
        }>();
      if (!show) return json({ error: "show_not_found" }, 404);
      const { results: bandRows } = await env.DB.prepare(
        `SELECT a.id AS artist_id, a.name, sa.position, sa.is_headliner,
                sa.source_setlist_date, sa.source_setlist_url
           FROM show_artists sa JOIN artists a ON a.id = sa.artist_id
          WHERE sa.show_id = ? ORDER BY sa.position`,
      )
        .bind(show.id)
        .all<{
          artist_id: number; name: string; position: number; is_headliner: number;
          source_setlist_date: string | null; source_setlist_url: string | null;
        }>();
      const { results: songRows } = await env.DB.prepare(
        `SELECT id, artist_id, position, title, original_artist, is_tape, included
           FROM songs WHERE show_id = ? ORDER BY position`,
      )
        .bind(show.id)
        .all<{
          id: number; artist_id: number; position: number; title: string;
          original_artist: string | null; is_tape: number; included: number;
        }>();
      const { results: playlists } = await env.DB.prepare(
        `SELECT service, external_playlist_id, external_url, title, tour_id
           FROM published_playlists
          WHERE show_id = ? OR (tour_id IS NOT NULL AND tour_id = ?)`,
      )
        .bind(show.id, show.tour_id)
        .all();
      return json({
        show,
        bands: bandRows.map((b) => ({
          ...b,
          songs: songRows.filter((s) => s.artist_id === b.artist_id),
        })),
        playlists,
      });
    }

    const selectionMatch = /^\/api\/shows\/([^/]+)\/selection$/.exec(url.pathname);
    if (selectionMatch && request.method === "POST") {
      const slug = decodeURIComponent(selectionMatch[1] as string);
      const body = (await request.json()) as { includedSongIds?: number[] };
      const show = await env.DB.prepare("SELECT id FROM shows WHERE slug = ?")
        .bind(slug)
        .first<{ id: number }>();
      if (!show) return json({ error: "show_not_found" }, 404);
      await env.DB.prepare("UPDATE songs SET included = 0 WHERE show_id = ?")
        .bind(show.id)
        .run();
      for (const id of body.includedSongIds ?? []) {
        await env.DB.prepare(
          "UPDATE songs SET included = 1 WHERE show_id = ? AND id = ?",
        )
          .bind(show.id, id)
          .run();
      }
      return json({ ok: true, included: (body.includedSongIds ?? []).length });
    }

    if (url.pathname === "/api/shows") {
      const { results } = await env.DB.prepare(
        `SELECT slug, title, venue, city, event_date, status
           FROM shows
          ORDER BY event_date DESC
          LIMIT 50`,
      ).all<ShowRow>();
      return json({ shows: results });
    }

    if (url.pathname === "/") {
      return new Response(homePage(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    const pageMatch = /^\/shows\/([^/]+)$/.exec(url.pathname);
    if (pageMatch) {
      return new Response(showPage(decodeURIComponent(pageMatch[1] as string)), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return json({ error: "not_found", path: url.pathname }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (err) {
      // Never surface a bare 1101: upstream API errors are diagnosable JSON.
      const message = err instanceof Error ? err.message : String(err);
      console.error(message);
      return json({ error: "upstream_or_internal", message }, 502);
    }
  },
} satisfies ExportedHandler<Env>;
