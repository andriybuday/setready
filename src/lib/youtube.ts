const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";

export const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";

export function youtubeAuthUrl(clientId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: YOUTUBE_SCOPE,
    access_type: "offline",
    prompt: "consent",
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  scope?: string;
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) {
    throw new Error(`Google token request failed: HTTP ${resp.status}`);
  }
  return (await resp.json()) as TokenResponse;
}

export function exchangeCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<TokenResponse> {
  return tokenRequest(
    new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  );
}

export async function accessTokenFromRefresh(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const tokens = await tokenRequest(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  );
  return tokens.access_token;
}

async function api<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const resp = await fetch(`${YOUTUBE_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 300);
    throw new Error(`YouTube API ${path} failed: HTTP ${resp.status} ${detail}`);
  }
  return (await resp.json()) as T;
}

/** Quota: 50 units. Canonical playlists are public: private YouTube-API
 * playlists do not surface in the owner's YouTube Music Library grid
 * (verified in the Phase 0 spike, docs/phase0.md). */
export async function createPlaylist(
  accessToken: string,
  title: string,
  description = "",
  privacyStatus: "public" | "unlisted" | "private" = "public",
): Promise<{ id: string }> {
  return api<{ id: string }>(accessToken, "/playlists?part=snippet,status", {
    method: "POST",
    body: JSON.stringify({
      snippet: { title, description },
      status: { privacyStatus },
    }),
  });
}

interface SearchResponse {
  items?: Array<{
    id?: { videoId?: string };
    snippet?: { title?: string; channelTitle?: string };
  }>;
}

export interface VideoCandidate {
  videoId: string;
  title: string;
  channelTitle: string;
}

/** Quota: counts against the separate search.list daily bucket. */
export async function searchVideos(
  accessToken: string,
  query: string,
  maxResults = 5,
): Promise<VideoCandidate[]> {
  const params = new URLSearchParams({
    part: "snippet",
    q: query,
    type: "video",
    videoCategoryId: "10", // Music
    maxResults: String(maxResults),
  });
  const data = await api<SearchResponse>(accessToken, `/search?${params.toString()}`);
  return (data.items ?? [])
    .filter((i) => i.id?.videoId)
    .map((i) => ({
      videoId: i.id?.videoId as string,
      title: i.snippet?.title ?? "",
      channelTitle: i.snippet?.channelTitle ?? "",
    }));
}

export async function searchFirstVideo(
  accessToken: string,
  query: string,
): Promise<{ videoId: string; title: string } | null> {
  const [first] = await searchVideos(accessToken, query, 1);
  return first ? { videoId: first.videoId, title: first.title } : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Quota: 50 units per item. Retries transient 409/5xx with backoff. */
export async function addPlaylistItem(
  accessToken: string,
  playlistId: string,
  videoId: string,
): Promise<void> {
  let lastErr: unknown;
  for (const delay of [0, 300, 900]) {
    if (delay) await sleep(delay);
    try {
      await api(accessToken, "/playlistItems?part=snippet", {
        method: "POST",
        body: JSON.stringify({
          snippet: {
            playlistId,
            resourceId: { kind: "youtube#video", videoId },
          },
        }),
      });
      return;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!/HTTP (409|500|503)\b/.test(msg)) throw err;
    }
  }
  throw lastErr;
}

export function playlistUrl(playlistId: string): string {
  return `https://www.youtube.com/playlist?list=${playlistId}`;
}

export function musicPlaylistUrl(playlistId: string): string {
  return `https://music.youtube.com/playlist?list=${playlistId}`;
}
