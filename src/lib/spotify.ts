const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";

export const SPOTIFY_SCOPES = [
  "playlist-modify-public",
  "playlist-modify-private",
  "user-read-private",
];

export function spotifyAuthUrl(clientId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SPOTIFY_SCOPES.join(" "),
    show_dialog: "true",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  scope?: string;
}

async function tokenRequest(
  body: URLSearchParams,
  clientId: string,
  clientSecret: string,
): Promise<TokenResponse> {
  const basic = btoa(`${clientId}:${clientSecret}`);
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 300);
    throw new Error(`Spotify token request failed: HTTP ${resp.status} ${detail}`);
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
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
    clientId,
    clientSecret,
  );
}

export async function accessTokenFromRefresh(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; refreshToken?: string }> {
  const tokens = await tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    clientId,
    clientSecret,
  );
  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token };
}

async function api<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  const resp = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 300);
    throw new Error(`Spotify API ${path} failed: HTTP ${resp.status} ${detail}`);
  }
  return (await resp.json()) as T;
}

export interface SpotifyProfile {
  id: string;
  displayName: string;
}

export async function getMe(accessToken: string): Promise<SpotifyProfile> {
  const data = await api<{ id: string; display_name?: string }>(accessToken, "/me");
  return { id: data.id, displayName: data.display_name ?? "" };
}

/** Create a public playlist on the authorized (SetReady) account. */
export async function createPlaylist(
  accessToken: string,
  name: string,
  description = "",
): Promise<{ id: string; url: string }> {
  const data = await api<{ id: string; external_urls?: { spotify?: string } }>(
    accessToken,
    "/me/playlists",
    {
      method: "POST",
      body: JSON.stringify({ name, description, public: true }),
    },
  );
  return {
    id: data.id,
    url: data.external_urls?.spotify ?? `https://open.spotify.com/playlist/${data.id}`,
  };
}

export interface TrackHit {
  uri: string;
  id: string;
  name: string;
  artists: string;
  artistNames: string[];
}

export function parseSearchHits(data: unknown): TrackHit[] {
  if (typeof data !== "object" || data === null) return [];
  const tracks = (data as Record<string, unknown>)["tracks"];
  if (typeof tracks !== "object" || tracks === null) return [];
  const items = (tracks as Record<string, unknown>)["items"];
  if (!Array.isArray(items)) return [];
  return items.flatMap((raw) => {
    const item = raw as Record<string, unknown>;
    if (typeof item["uri"] !== "string" || typeof item["id"] !== "string") return [];
    const artistNames = Array.isArray(item["artists"])
      ? item["artists"]
          .map((a) => (a as Record<string, unknown>)["name"])
          .filter((n): n is string => typeof n === "string")
      : [];
    return [{
      uri: item["uri"],
      id: item["id"],
      name: typeof item["name"] === "string" ? item["name"] : "",
      artists: artistNames.join(", "),
      artistNames,
    }];
  });
}

export function parseSearchHit(data: unknown): TrackHit | null {
  return parseSearchHits(data)[0] ?? null;
}

export async function searchTracks(
  accessToken: string,
  artist: string,
  title: string,
  limit = 10,
): Promise<TrackHit[]> {
  const params = new URLSearchParams({
    q: `artist:${artist} track:${title}`,
    type: "track",
    limit: String(limit),
  });
  return parseSearchHits(await api(accessToken, `/search?${params.toString()}`));
}

export async function searchTrack(
  accessToken: string,
  artist: string,
  title: string,
): Promise<TrackHit | null> {
  return (await searchTracks(accessToken, artist, title, 1))[0] ?? null;
}

export async function changePlaylistDetails(
  accessToken: string,
  playlistId: string,
  details: { name: string; description: string },
): Promise<void> {
  const resp = await fetch(`${API}/playlists/${playlistId}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ ...details, public: true }),
  });
  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 300);
    throw new Error(`Spotify change details failed: HTTP ${resp.status} ${detail}`);
  }
}

/** Current track URIs of a playlist, in order. */
export async function getPlaylistUris(accessToken: string, playlistId: string): Promise<string[]> {
  const uris: string[] = [];
  let path: string | null = `/playlists/${playlistId}/items?limit=50`;
  while (path) {
    const data: { items?: Array<{ item?: { uri?: string }; track?: { uri?: string } }>; next?: string | null } =
      await api(accessToken, path);
    for (const it of data.items ?? []) {
      const uri = it.item?.uri ?? it.track?.uri;
      if (uri) uris.push(uri);
    }
    path = data.next ? data.next.replace(API, "") : null;
  }
  return uris;
}

/** Replace all items (first 100 URIs) of an existing playlist. */
export async function replacePlaylistItems(
  accessToken: string,
  playlistId: string,
  uris: string[],
): Promise<void> {
  const resp = await fetch(`${API}/playlists/${playlistId}/items`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ uris: uris.slice(0, 100) }),
  });
  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 300);
    throw new Error(`Spotify replace items failed: HTTP ${resp.status} ${detail}`);
  }
}

/** Add up to 100 track URIs to a playlist. */
export async function addPlaylistItems(
  accessToken: string,
  playlistId: string,
  uris: string[],
): Promise<void> {
  await api(accessToken, `/playlists/${playlistId}/items`, {
    method: "POST",
    body: JSON.stringify({ uris }),
  });
}
