import { normalizeName } from "./normalize";
import {
  matchArtist,
  publishableSongs,
  type ShowSongRow,
} from "./publish";
import * as spotify from "./spotify";
import { listTourStops } from "./tours";

/**
 * Pick the best Spotify candidate: artist must match, title must match,
 * studio versions over live/karaoke/tribute, never reuse a URI already
 * placed in this playlist.
 */
export function chooseSpotifyCandidate(
  candidates: spotify.TrackHit[],
  artist: string,
  title: string,
  usedUris: ReadonlySet<string>,
): spotify.TrackHit | null {
  const artistNorm = normalizeName(artist);
  const titleNorm = normalizeName(title);
  let best: spotify.TrackHit | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    if (usedUris.has(c.uri)) continue;
    if (!c.artistNames.some((a) => normalizeName(a) === artistNorm)) continue;
    const nameNorm = normalizeName(c.name);
    let score = 0;
    if (nameNorm === titleNorm) score += 30;
    else if (nameNorm.startsWith(titleNorm)) score += 15;
    else if (nameNorm.includes(titleNorm)) score += 5;
    else continue;
    if (/\blive\b/.test(nameNorm)) score -= 25;
    if (/(karaoke|tribute|remix|sped up|nightcore)/.test(nameNorm)) score -= 25;
    if (/remaster/.test(nameNorm)) score += 2;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** Spotify caps playlist descriptions at 300 characters. */
export function spotifyDescription(input: {
  tourName: string;
  bandsInPlayingOrder: string[];
  stops: Array<{ event_date: string; venue: string | null; city?: string | null }>;
}): string {
  const order = input.bandsInPlayingOrder.join(" → ");
  const cityOf = (s: { venue: string | null; city?: string | null }) =>
    s.city ?? (s.venue ?? "").split(",")[1]?.trim() ?? "";
  const first = input.stops[0];
  const last = input.stops[input.stops.length - 1];
  const range = first && last
    ? `${input.stops.length} stops with this lineup: ${first.event_date} ${cityOf(first)} → ${last.event_date} ${cityOf(last)}. `
    : "";
  const text =
    `Hear the show before doors — every stop on this tour. ` +
    `Made by SetReady from real setlists (setlist.fm), in playing order: ${order}. ` +
    range +
    `Full stop list on the YouTube Music edition.`;
  return text.length <= 300 ? text : `${text.slice(0, 297).trimEnd()}…`;
}

export interface SpotifyPublishResult {
  playlistId: string;
  spotify: string;
  title: string;
  added: number;
  unmatched: Array<{ artist: string; title: string }>;
  failed: Array<{ artist: string; title: string; error: string }>;
  fromCache: number;
  searched: number;
}

interface CachedMatch {
  status: string;
  service_track_id: string | null;
  service_track_uri: string | null;
}

export async function publishShowToSpotify(
  db: D1Database,
  slug: string,
  clientId: string,
  clientSecret: string,
  overrides: { title?: string; tourName?: string } = {},
): Promise<SpotifyPublishResult> {
  const show = await db
    .prepare(
      "SELECT id, slug, title, venue, event_date, tour_id, tour_name FROM shows WHERE slug = ?",
    )
    .bind(slug)
    .first<{
      id: number; slug: string; title: string; venue: string | null;
      event_date: string; tour_id: number | null; tour_name: string | null;
    }>();
  if (!show) throw new Error(`show not found: ${slug}`);

  const cred = await db
    .prepare("SELECT refresh_token FROM oauth_credentials WHERE service = 'spotify'")
    .first<{ refresh_token: string }>();
  if (!cred) throw new Error("spotify publisher not connected");

  const { results } = await db
    .prepare(
      `SELECT a.name AS artist_name, s.title, s.normalized_title,
              s.original_artist, s.is_tape, s.included
         FROM songs s
         JOIN artists a ON a.id = s.artist_id
         JOIN show_artists sa
           ON sa.show_id = s.show_id AND sa.artist_id = s.artist_id
        WHERE s.show_id = ?
        ORDER BY sa.position, s.position`,
    )
    .bind(show.id)
    .all<ShowSongRow>();

  const songs = publishableSongs(results);
  if (songs.length === 0) throw new Error("show has no publishable songs");

  const { accessToken, refreshToken: rotated } = await spotify.accessTokenFromRefresh(
    cred.refresh_token,
    clientId,
    clientSecret,
  );
  if (rotated) {
    await db
      .prepare(
        "UPDATE oauth_credentials SET refresh_token = ?, updated_at = datetime('now') WHERE service = 'spotify'",
      )
      .bind(rotated)
      .run();
  }

  let fromCache = 0;
  let searched = 0;
  const entries: Array<{ artist: string; title: string; uri: string }> = [];
  const usedUris = new Set<string>();
  const unmatched: Array<{ artist: string; title: string }> = [];

  for (const song of songs) {
    const artist = matchArtist(song);
    const artistNorm = normalizeName(artist);
    const cached = await db
      .prepare(
        `SELECT status, service_track_id, service_track_uri FROM track_matches
          WHERE service = 'spotify' AND artist_normalized = ? AND title_normalized = ?`,
      )
      .bind(artistNorm, song.normalized_title)
      .first<CachedMatch>();

    if (
      cached?.status === "matched" &&
      cached.service_track_uri &&
      !usedUris.has(cached.service_track_uri)
    ) {
      fromCache += 1;
      usedUris.add(cached.service_track_uri);
      entries.push({ artist, title: song.title, uri: cached.service_track_uri });
      continue;
    }
    if (cached?.status === "unmatched") {
      fromCache += 1;
      unmatched.push({ artist, title: song.title });
      continue;
    }

    searched += 1;
    const candidates = await spotify.searchTracks(accessToken, artist, song.title, 10);
    const hit = chooseSpotifyCandidate(candidates, artist, song.title, usedUris);
    await db
      .prepare(
        `INSERT INTO track_matches
           (service, artist_normalized, title_normalized, status,
            service_track_id, service_track_uri, matched_title, matched_artist, confidence)
         VALUES ('spotify', ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(service, artist_normalized, title_normalized) DO UPDATE SET
           status = excluded.status,
           service_track_id = excluded.service_track_id,
           service_track_uri = excluded.service_track_uri,
           matched_title = excluded.matched_title,
           matched_artist = excluded.matched_artist,
           confidence = excluded.confidence,
           updated_at = datetime('now')`,
      )
      .bind(
        artistNorm,
        song.normalized_title,
        hit ? "matched" : "unmatched",
        hit?.id ?? null,
        hit?.uri ?? null,
        hit?.name ?? null,
        hit?.artists ?? artist,
        hit ? 0.7 : null,
      )
      .run();
    if (hit) {
      usedUris.add(hit.uri);
      entries.push({ artist, title: song.title, uri: hit.uri });
    } else {
      unmatched.push({ artist, title: song.title });
    }
  }

  const displayTitle = overrides.title ?? show.title;
  const bandsInPlayingOrder = [...new Set(songs.map((s) => s.artist_name))];
  const stops = show.tour_id
    ? await listTourStops(db, show.tour_id)
    : [{ slug: show.slug, event_date: show.event_date, venue: show.venue, city: null, confidence: "confirmed" as const }];
  const playlist = await spotify.createPlaylist(
    accessToken,
    displayTitle,
    spotifyDescription({
      tourName: overrides.tourName ?? show.tour_name ?? "",
      bandsInPlayingOrder,
      stops,
    }),
  );

  const failed: SpotifyPublishResult["failed"] = [];
  let added = 0;
  // Spotify accepts up to 100 URIs per add call; chunk to be safe.
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    try {
      await spotify.addPlaylistItems(
        accessToken,
        playlist.id,
        chunk.map((e) => e.uri),
      );
      added += chunk.length;
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 200) : String(err);
      for (const e of chunk) failed.push({ artist: e.artist, title: e.title, error: message });
    }
  }

  await db
    .prepare(
      `INSERT INTO published_playlists
         (show_id, tour_id, service, external_playlist_id, external_url, title)
       VALUES (?, ?, 'spotify', ?, ?, ?)
       ON CONFLICT(show_id, service) DO UPDATE SET
         tour_id = excluded.tour_id,
         external_playlist_id = excluded.external_playlist_id,
         external_url = excluded.external_url,
         title = excluded.title, updated_at = datetime('now')`,
    )
    .bind(show.id, show.tour_id, playlist.id, playlist.url, displayTitle)
    .run();

  return {
    playlistId: playlist.id,
    spotify: playlist.url,
    title: displayTitle,
    added,
    unmatched,
    failed,
    fromCache,
    searched,
  };
}

export async function publishTourToSpotify(
  db: D1Database,
  tourSlug: string,
  clientId: string,
  clientSecret: string,
): Promise<SpotifyPublishResult & { tourSlug: string }> {
  const tour = await db
    .prepare("SELECT id, title, tour_name FROM tours WHERE slug = ?")
    .bind(tourSlug)
    .first<{ id: number; title: string; tour_name: string }>();
  if (!tour) throw new Error(`tour not found: ${tourSlug}`);
  const rep = await db
    .prepare(
      `SELECT slug FROM shows WHERE tour_id = ?
        ORDER BY updated_at DESC, event_date DESC LIMIT 1`,
    )
    .bind(tour.id)
    .first<{ slug: string }>();
  if (!rep) throw new Error(`tour has no built stops: ${tourSlug}`);
  const result = await publishShowToSpotify(db, rep.slug, clientId, clientSecret, {
    title: tour.title,
    tourName: tour.tour_name,
  });
  return { ...result, tourSlug };
}
