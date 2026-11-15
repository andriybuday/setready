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

export interface PlaylistItem {
  itemId: string;
  videoId: string;
  position: number;
}

/** Quota: 1 unit per page. */
export async function listPlaylistItems(
  accessToken: string,
  playlistId: string,
): Promise<PlaylistItem[]> {
  const items: PlaylistItem[] = [];
  let pageToken = "";
  for (;;) {
    const params = new URLSearchParams({
      part: "snippet",
      playlistId,
      maxResults: "50",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await api<{
      items?: Array<{
        id?: string;
        snippet?: { position?: number; resourceId?: { videoId?: string } };
      }>;
      nextPageToken?: string;
    }>(accessToken, `/playlistItems?${params.toString()}`);
    for (const it of data.items ?? []) {
      if (it.id && it.snippet?.resourceId?.videoId) {
        items.push({
          itemId: it.id,
          videoId: it.snippet.resourceId.videoId,
          position: it.snippet.position ?? items.length,
        });
      }
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return items.sort((a, b) => a.position - b.position);
}

/** Quota: 50 units. */
export async function deletePlaylistItem(accessToken: string, itemId: string): Promise<void> {
  const resp = await fetch(
    `${YOUTUBE_API}/playlistItems?id=${encodeURIComponent(itemId)}`,
    { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 300);
    throw new Error(`YouTube delete playlistItem failed: HTTP ${resp.status} ${detail}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Quota: 50 units per item. Retries transient 409/5xx with backoff. */
export async function addPlaylistItem(
  accessToken: string,
  playlistId: string,
  videoId: string,
  position?: number,
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
            ...(position !== undefined ? { position } : {}),
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

/** Quota: 50 units. Update title/description of an existing playlist. */
export async function updatePlaylist(
  accessToken: string,
  playlistId: string,
  title: string,
  description: string,
): Promise<void> {
  await api(accessToken, "/playlists?part=snippet,status", {
    method: "PUT",
    body: JSON.stringify({
      id: playlistId,
      snippet: { title, description },
      status: { privacyStatus: "public" },
    }),
  });
}

/** Quota: 1 unit. Identity of the authorized publisher channel. */
export async function getMyChannel(
  accessToken: string,
): Promise<{ id: string; title: string } | null> {
  const data = await api<{
    items?: Array<{ id?: string; snippet?: { title?: string } }>;
  }>(accessToken, "/channels?part=snippet&mine=true");
  const item = data.items?.[0];
  return item?.id ? { id: item.id, title: item.snippet?.title ?? "" } : null;
}

export function playlistUrl(playlistId: string): string {
  return `https://www.youtube.com/playlist?list=${playlistId}`;
}

export function musicPlaylistUrl(playlistId: string): string {
  return `https://music.youtube.com/playlist?list=${playlistId}`;
}
