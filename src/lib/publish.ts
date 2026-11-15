import { normalizeName } from "./normalize";
import { listTourStops, type TourStop } from "./tours";
import * as youtube from "./youtube";

export interface ShowSongRow {
  artist_name: string;
  title: string;
  normalized_title: string;
  original_artist: string | null;
  is_tape: number;
  included: number;
}

/** Songs to publish: included, not tape intros (performed music only). */
export function publishableSongs(rows: ShowSongRow[]): ShowSongRow[] {
  return rows.filter((r) => r.included === 1 && r.is_tape === 0);
}

/** Performing credit used for matching: original artist for covers. */
export function matchArtist(row: ShowSongRow): string {
  return row.original_artist ?? row.artist_name;
}

/**
 * Pick the best search candidate for a song. Rejects videos already used
 * in this playlist (a repeat insert is a YouTube 409 duplicate), titles
 * that don't contain the song title, and live/medley uploads when a
 * studio/official option exists. Topic-channel audio ranks highest.
 */
export function chooseCandidate(
  candidates: youtube.VideoCandidate[],
  artist: string,
  title: string,
  usedVideoIds: ReadonlySet<string>,
): youtube.VideoCandidate | null {
  const artistNorm = normalizeName(artist);
  const titleNorm = normalizeName(title);
  let best: youtube.VideoCandidate | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    if (usedVideoIds.has(c.videoId)) continue;
    const t = normalizeName(c.title);
    if (!t.includes(titleNorm)) continue;
    let score = 0;
    if (c.channelTitle.trim().toLowerCase().endsWith("- topic")) score += 30;
    if (normalizeName(c.channelTitle).includes(artistNorm)) score += 15;
    if (t.startsWith(`${artistNorm} ${titleNorm}`) || t.startsWith(titleNorm)) score += 20;
    if (/(official audio|audio only)/.test(t)) score += 10;
    else if (/official (music )?video/.test(t)) score += 6;
    else if (/(visualizer|lyric)/.test(t)) score += 3;
    if (/\blive\b/.test(t)) score -= 30;
    if (c.title.includes("+")) score -= 20;
    if (/(full album|full concert|karaoke|tribute|remix|cover version)/.test(t)) score -= 20;
    score -= Math.max(0, t.split(" ").length - (titleNorm.split(" ").length + 5));
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

interface CachedMatch {
  status: string;
  service_track_id: string | null;
  matched_title: string | null;
}

/**
 * Public playlist description. Sells the provenance honestly: real
 * setlists from this tour via setlist.fm — not "verified", because
 * community setlists can change night to night.
 */
export function playlistDescription(input: {
  tourName: string;
  bandsInPlayingOrder: string[];
  stops: TourStop[];
}): string {
  const order = input.bandsInPlayingOrder.join(" → ");
  const stopLines = input.stops.map((s) =>
    s.city
      ? `• ${s.event_date} — ${s.city} · ${s.venue ?? ""}`.trimEnd()
      : `• ${s.event_date} — ${s.venue ?? s.slug}`,
  );
  return [
    "Hear the show before doors — at every stop on this tour.",
    "",
    "Made by SetReady from the real setlists these bands have been playing " +
      "on this tour — sourced from setlist.fm, matched song by song, and " +
      `sequenced in playing order: ${order}.`,
    "",
    input.tourName
      ? `For these ${input.tourName} stops with this lineup:`
      : "For these stops with this lineup:",
    ...stopLines,
    "",
    "Public playlist — save it and share it with your crew. " +
      "Updated as the tour evolves; a song or two " +
      "can rotate night to night, so treat this as your best-possible " +
      "preview, not a guarantee.",
  ].join("\n");
}

export interface PublishResult {
  playlistId: string;
  youtube: string;
  youtubeMusic: string;
  title: string;
  added: number;
  unmatched: Array<{ artist: string; title: string }>;
  failed: Array<{ artist: string; title: string; error: string }>;
  fromCache: number;
  searched: number;
}

/**
 * Publish a saved show as a public canonical playlist on the SetReady
 * YouTube channel. Track matches go through the shared D1 cache first
 * (search.list quota is the scarce resource); misses are cached too.
 */
export async function publishShowToYouTube(
  db: D1Database,
  slug: string,
  clientId: string,
  clientSecret: string,
  overrides: { title?: string; tourName?: string } = {},
): Promise<PublishResult> {
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
    .prepare("SELECT refresh_token FROM oauth_credentials WHERE service = 'youtube'")
    .first<{ refresh_token: string }>();
  if (!cred) throw new Error("youtube publisher not connected");

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

  const accessToken = await youtube.accessTokenFromRefresh(
    cred.refresh_token,
    clientId,
    clientSecret,
  );

  let fromCache = 0;
  let searched = 0;
  const entries: Array<{ artist: string; title: string; videoId: string }> = [];
  const usedVideoIds = new Set<string>();
  const unmatched: Array<{ artist: string; title: string }> = [];

  for (const song of songs) {
    const artist = matchArtist(song);
    const artistNorm = normalizeName(artist);
    const cached = await db
      .prepare(
        `SELECT status, service_track_id, matched_title FROM track_matches
          WHERE service = 'youtube' AND artist_normalized = ? AND title_normalized = ?`,
      )
      .bind(artistNorm, song.normalized_title)
      .first<CachedMatch>();

    if (
      cached?.status === "matched" &&
      cached.service_track_id &&
      !usedVideoIds.has(cached.service_track_id)
    ) {
      fromCache += 1;
      usedVideoIds.add(cached.service_track_id);
      entries.push({ artist, title: song.title, videoId: cached.service_track_id });
      continue;
    }
    if (cached?.status === "unmatched") {
      fromCache += 1;
      unmatched.push({ artist, title: song.title });
      continue;
    }
    // No cache row, or the cached video is already used by an earlier
    // song in this playlist (duplicate insert -> YouTube 409). Search
    // for a distinct candidate and refresh the cache row.
    searched += 1;
    // Plain artist+title ranks official uploads best; appending
    // "official audio" buries official videos on some queries.
    const candidates = await youtube.searchVideos(
      accessToken,
      `${artist} ${song.title}`,
      10,
    );
    const hit = chooseCandidate(candidates, artist, song.title, usedVideoIds);
    await db
      .prepare(
        `INSERT INTO track_matches
           (service, artist_normalized, title_normalized, status,
            service_track_id, matched_title, matched_artist, confidence)
         VALUES ('youtube', ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(service, artist_normalized, title_normalized) DO UPDATE SET
           status = excluded.status,
           service_track_id = excluded.service_track_id,
           matched_title = excluded.matched_title,
           matched_artist = excluded.matched_artist,
           confidence = excluded.confidence,
           updated_at = datetime('now')`,
      )
      .bind(
        artistNorm,
        song.normalized_title,
        hit ? "matched" : "unmatched",
        hit?.videoId ?? null,
        hit?.title ?? null,
        artist,
        hit ? 0.5 : null,
      )
      .run();
    if (hit) {
      usedVideoIds.add(hit.videoId);
      entries.push({ artist, title: song.title, videoId: hit.videoId });
    } else {
      unmatched.push({ artist, title: song.title });
    }
  }

  const bandsInPlayingOrder = [...new Set(songs.map((s) => s.artist_name))];
  const stops = show.tour_id
    ? await listTourStops(db, show.tour_id)
    : [{ slug: show.slug, event_date: show.event_date, venue: show.venue, city: null, confidence: "confirmed" as const }];
  const displayTitle = overrides.title ?? show.title;
  const playlist = await youtube.createPlaylist(
    accessToken,
    displayTitle,
    playlistDescription({
      tourName: overrides.tourName ?? show.tour_name ?? "",
      bandsInPlayingOrder,
      stops,
    }),
  );
  // One bad item must not abort the whole publish after the playlist
  // exists; collect failures and report them.
  const failed: Array<{ artist: string; title: string; error: string }> = [];
  let added = 0;
  for (const entry of entries) {
    try {
      await youtube.addPlaylistItem(accessToken, playlist.id, entry.videoId);
      added += 1;
    } catch (err) {
      failed.push({
        artist: entry.artist,
        title: entry.title,
        error: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    }
  }

  const url = youtube.playlistUrl(playlist.id);
  await db
    .prepare(
      `INSERT INTO published_playlists
         (show_id, tour_id, service, external_playlist_id, external_url, title)
       VALUES (?, ?, 'youtube', ?, ?, ?)
       ON CONFLICT(show_id, service) DO UPDATE SET
         tour_id = excluded.tour_id,
         external_playlist_id = excluded.external_playlist_id,
         external_url = excluded.external_url,
         title = excluded.title, updated_at = datetime('now')`,
    )
    .bind(show.id, show.tour_id, playlist.id, url, displayTitle)
    .run();

  return {
    playlistId: playlist.id,
    youtube: url,
    youtubeMusic: youtube.musicPlaylistUrl(playlist.id),
    title: displayTitle,
    added,
    unmatched,
    failed,
    fromCache,
    searched,
  };
}

/**
 * Publish the tour-level canonical playlist, using the most recently
 * built stop as the tracklist source. The description lists every
 * dated stop in SetReady that shares this tour + lineup.
 */
export async function publishTourToYouTube(
  db: D1Database,
  tourSlug: string,
  clientId: string,
  clientSecret: string,
): Promise<PublishResult & { tourSlug: string; stops: TourStop[] }> {
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
  const result = await publishShowToYouTube(db, rep.slug, clientId, clientSecret, {
    title: tour.title,
    tourName: tour.tour_name,
  });
  return { ...result, tourSlug, stops: await listTourStops(db, tour.id) };
}
