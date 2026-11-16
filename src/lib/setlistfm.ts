const BASE = "https://api.setlist.fm/rest/1.0";

export interface SetlistSong {
  title: string;
  /** Original artist when this entry is a cover, else null. */
  originalArtist: string | null;
  /** Played from tape (intro/interlude), not performed live. */
  tape: boolean;
}

export interface RecentSetlist {
  songs: SetlistSong[];
  /** DD-MM-YYYY as returned by setlist.fm. */
  date: string;
  venue: string;
  city: string;
  country: string;
  url: string;
  setlistId: string;
}

type FetchFn = typeof fetch;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Extract ordered songs (with cover/tape metadata) from a raw setlist. */
export function extractSongs(setlist: unknown): SetlistSong[] {
  if (!isRecord(setlist)) return [];
  const sets = isRecord(setlist["sets"]) ? setlist["sets"] : {};
  const songs: SetlistSong[] = [];
  for (const section of asArray(sets["set"])) {
    if (!isRecord(section)) continue;
    for (const song of asArray(section["song"])) {
      if (!isRecord(song)) continue;
      const title = asString(song["name"]).trim();
      if (!title) continue;
      const cover = isRecord(song["cover"]) ? song["cover"] : null;
      songs.push({
        title,
        originalArtist: cover ? asString(cover["name"]) || null : null,
        tape: song["tape"] === true,
      });
    }
  }
  return songs;
}

/** setlist.fm eventDate is DD-MM-YYYY; return a comparable YYYYMMDD number. */
export function parseSetlistDate(dateStr: string): number | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dateStr);
  if (!m) return null;
  return Number(`${m[3]}${m[2]}${m[1]}`);
}

function cutoffNumber(beforeDate: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(beforeDate);
  if (!m) throw new Error(`beforeDate must be YYYY-MM-DD, got ${beforeDate}`);
  return Number(`${m[1]}${m[2]}${m[3]}`);
}

export function parseSetlist(setlist: unknown): RecentSetlist | null {
  if (!isRecord(setlist)) return null;
  const songs = extractSongs(setlist);
  if (songs.length === 0) return null;
  const venue = isRecord(setlist["venue"]) ? setlist["venue"] : {};
  const city = isRecord(venue["city"]) ? venue["city"] : {};
  const country = isRecord(city["country"]) ? city["country"] : {};
  return {
    songs,
    date: asString(setlist["eventDate"]),
    venue: asString(venue["name"]),
    city: asString(city["name"]),
    country: asString(country["name"]),
    url: asString(setlist["url"]),
    setlistId: asString(setlist["id"]),
  };
}

async function getJson(
  fetchFn: FetchFn,
  path: string,
  params: Record<string, string>,
  apiKey: string,
): Promise<{ status: number; data: unknown }> {
  const url = `${BASE}${path}?${new URLSearchParams(params).toString()}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await fetchFn(url, {
      headers: { "x-api-key": apiKey, accept: "application/json" },
    });
    if (resp.status === 404) return { status: 404, data: null };
    if (resp.status === 429) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      throw new Error("setlist.fm rate limit hit — wait a moment and try again.");
    }
    if (!resp.ok) throw new Error(`setlist.fm returned HTTP ${resp.status}`);
    return { status: resp.status, data: await resp.json() };
  }
  throw new Error("setlist.fm rate limit hit — wait a moment and try again.");
}

/** "Did you mean?" artist suggestions for a name with no setlists. */
export async function searchArtists(
  name: string,
  apiKey: string,
  limit = 3,
  fetchFn: FetchFn = fetch,
): Promise<string[]> {
  try {
    const { data } = await getJson(
      fetchFn,
      "/search/artists",
      { artistName: name, p: "1", sort: "relevance" },
      apiKey,
    );
    if (!isRecord(data)) return [];
    return asArray(data["artist"])
      .filter(isRecord)
      .map((a) => asString(a["name"]))
      .filter(Boolean)
      .slice(0, limit);
  } catch {
    return [];
  }
}

/** Up to `limit` most recent non-empty setlists strictly before beforeDate. */
export async function getRecentSetlists(
  artistName: string,
  beforeDate: string,
  apiKey: string,
  limit = 5,
  fetchFn: FetchFn = fetch,
): Promise<RecentSetlist[]> {
  const cutoff = cutoffNumber(beforeDate);
  const out: RecentSetlist[] = [];
  for (let page = 1; page <= 5 && out.length < limit; page++) {
    const { status, data } = await getJson(
      fetchFn,
      "/search/setlists",
      { artistName, p: String(page) },
      apiKey,
    );
    if (status === 404 || !isRecord(data)) break;
    const setlists = asArray(data["setlist"]);
    if (setlists.length === 0) break;
    for (const raw of setlists) {
      if (!isRecord(raw)) continue;
      const showDate = parseSetlistDate(asString(raw["eventDate"]));
      if (showDate === null || showDate >= cutoff) continue;
      const parsed = parseSetlist(raw);
      if (parsed) out.push(parsed);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Exact setlist played on `date` (YYYY-MM-DD), for post-show actuals. */
export async function getSetlistOnDate(
  artistName: string,
  date: string,
  apiKey: string,
  fetchFn: FetchFn = fetch,
): Promise<RecentSetlist | null> {
  const target = cutoffNumber(date);
  for (let page = 1; page <= 3; page++) {
    const { status, data } = await getJson(
      fetchFn,
      "/search/setlists",
      { artistName, p: String(page) },
      apiKey,
    );
    if (status === 404 || !isRecord(data)) return null;
    const setlists = asArray(data["setlist"]);
    if (setlists.length === 0) break;
    let olderSeen = false;
    for (const raw of setlists) {
      if (!isRecord(raw)) continue;
      const showDate = parseSetlistDate(asString(raw["eventDate"]));
      if (showDate === null) continue;
      if (showDate === target) {
        const parsed = parseSetlist(raw);
        if (parsed) return parsed;
      }
      if (showDate < target) olderSeen = true;
    }
    if (olderSeen) break; // results are date-descending; passed the target
  }
  return null;
}

/**
 * Most recent setlist strictly before `beforeDate` (YYYY-MM-DD).
 * Mirrors the setlistmaker prototype: max 3 search pages, skip empty
 * and on/after-date shows.
 */
export async function getMostRecentSetlist(
  artistName: string,
  beforeDate: string,
  apiKey: string,
  fetchFn: FetchFn = fetch,
): Promise<RecentSetlist | null> {
  const cutoff = cutoffNumber(beforeDate);
  for (let page = 1; page <= 3; page++) {
    const { status, data } = await getJson(
      fetchFn,
      "/search/setlists",
      { artistName, p: String(page) },
      apiKey,
    );
    if (status === 404 || !isRecord(data)) return null;
    const setlists = asArray(data["setlist"]);
    if (setlists.length === 0) break;
    for (const raw of setlists) {
      if (!isRecord(raw)) continue;
      const showDate = parseSetlistDate(asString(raw["eventDate"]));
      if (showDate === null || showDate >= cutoff) continue;
      const parsed = parseSetlist(raw);
      if (parsed) return parsed;
    }
  }
  return null;
}
