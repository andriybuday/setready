const BASE = "https://app.ticketmaster.com/discovery/v2";

export interface Lineup {
  /** Playing order: opener first, headliner last. */
  lineup: string[];
  venue: string;
  tourName: string;
  /** Local date of the matched event, YYYY-MM-DD when available. */
  eventDate: string;
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

export interface TourEvent {
  eventDate: string;
  eventName: string;
  venue: string;
  city: string;
  region: string;
  country: string;
  ticketmasterEventId: string;
  /** Attraction names in playing order (opener first). */
  lineup: string[];
  /** Billing order as listed (headliner first). */
  billing: string[];
  genres: string[];
  attractionCount: number;
}

function playingOrder(names: string[], artistName: string): string[] {
  const lower = artistName.toLowerCase();
  const headliner = names.find((n) => n.toLowerCase() === lower);
  return headliner
    ? [...names.filter((n) => n.toLowerCase() !== lower).reverse(), headliner]
    : [...names].reverse();
}

/**
 * Enumerate a headliner's upcoming tour events, deduplicated by
 * date+city preferring the listing with the richest attraction data
 * (Ticketmaster often returns duplicate sparse/full listings).
 */
export function parseTourEvents(data: unknown, artistName = ""): TourEvent[] {
  if (!isRecord(data)) return [];
  const embedded = isRecord(data["_embedded"]) ? data["_embedded"] : {};
  const byKey = new Map<string, TourEvent>();
  for (const event of asArray(embedded["events"]).filter(isRecord)) {
    const eventDate = eventLocalDate(event);
    if (!eventDate) continue;
    const evEmbedded = isRecord(event["_embedded"]) ? event["_embedded"] : {};
    const names = asArray(evEmbedded["attractions"])
      .filter(isRecord)
      .map((a) => asString(a["name"]))
      .filter(Boolean);
    if (names.length === 0) continue;
    if (artistName && !names.some((n) => n.toLowerCase() === artistName.toLowerCase())) continue;
    const headliner = artistName || (names[0] as string);
    const venueData = asArray(evEmbedded["venues"]).filter(isRecord)[0] ?? {};
    const cityObj = isRecord(venueData["city"]) ? venueData["city"] : {};
    const stateObj = isRecord(venueData["state"]) ? venueData["state"] : {};
    const countryObj = isRecord(venueData["country"]) ? venueData["country"] : {};
    const genres = new Set<string>();
    for (const c of asArray(event["classifications"]).filter(isRecord)) {
      for (const kind of ["genre", "subGenre"] as const) {
        const obj = isRecord(c[kind]) ? c[kind] : {};
        const name = asString(obj["name"]);
        if (name && name !== "Undefined") genres.add(name);
      }
    }
    const parsed: TourEvent = {
      eventDate,
      eventName: asString(event["name"]),
      venue: asString(venueData["name"]),
      city: asString(cityObj["name"]),
      region: asString(stateObj["name"]),
      country: asString(countryObj["name"]),
      ticketmasterEventId: asString(event["id"]),
      lineup: playingOrder(names, headliner),
      billing: names,
      genres: [...genres],
      attractionCount: names.length,
    };
    const key = `${eventDate}|${parsed.city.toLowerCase()}|${(parsed.billing[0] ?? "").toLowerCase()}`;
    const prev = byKey.get(key);
    if (!prev || parsed.attractionCount > prev.attractionCount) byKey.set(key, parsed);
  }
  return [...byKey.values()].sort((a, b) => a.eventDate.localeCompare(b.eventDate));
}

export async function getTourEvents(
  artistName: string,
  apiKey: string,
  fetchFn: FetchFn = fetch,
): Promise<TourEvent[]> {
  const params = new URLSearchParams({
    keyword: artistName,
    classificationName: "music",
    size: "100",
    sort: "date,asc",
    apikey: apiKey,
  });
  const resp = await fetchFn(`${BASE}/events.json?${params.toString()}`);
  if (resp.status === 401) throw new Error("Invalid Ticketmaster API key.");
  if (!resp.ok) throw new Error(`Ticketmaster returned HTTP ${resp.status}`);
  return parseTourEvents(await resp.json(), artistName);
}

/** All music events in a date window (up to maxPages x 200, deduped). */
export async function getMusicEvents(
  startDate: string,
  endDate: string,
  apiKey: string,
  maxPages = 5,
  fetchFn: FetchFn = fetch,
): Promise<TourEvent[]> {
  const all: TourEvent[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      classificationName: "music",
      startDateTime: `${startDate}T00:00:00Z`,
      endDateTime: `${endDate}T23:59:59Z`,
      size: "200",
      page: String(page),
      sort: "date,asc",
      apikey: apiKey,
    });
    const resp = await fetchFn(`${BASE}/events.json?${params.toString()}`);
    if (resp.status === 401) throw new Error("Invalid Ticketmaster API key.");
    if (!resp.ok) throw new Error(`Ticketmaster returned HTTP ${resp.status}`);
    const batch = parseTourEvents(await resp.json(), "");
    if (batch.length === 0) break;
    for (const e of batch) {
      const key = `${e.eventDate}|${e.city.toLowerCase()}|${(e.billing[0] ?? "").toLowerCase()}`;
      if (seen.has(key)) continue;
      // Drop season packages / venue passes / add-ons masquerading as events
      const name = e.eventName.toLowerCase();
      if (/package|pass\b|series pass|entry to all|premium\b/.test(name)) continue;
      seen.add(key);
      if (e.eventDate >= startDate && e.eventDate <= endDate) all.push(e);
    }
  }
  return all.sort((a, b) => a.eventDate.localeCompare(b.eventDate));
}

function eventLocalDate(event: Record<string, unknown>): string {
  const dates = isRecord(event["dates"]) ? event["dates"] : {};
  const start = isRecord(dates["start"]) ? dates["start"] : {};
  return asString(start["localDate"]);
}

/**
 * Parse a Discovery events response into a lineup. When targetDate is
 * given, the event on that exact local date wins — adjacent tour stops
 * within the search window must not shadow the real show.
 */
export function parseLineup(
  data: unknown,
  artistName: string,
  targetDate = "",
): Lineup | null {
  if (!isRecord(data)) return null;
  const embedded = isRecord(data["_embedded"]) ? data["_embedded"] : {};
  const events = asArray(embedded["events"]).filter(isRecord);
  const ordered = targetDate
    ? [
        ...events.filter((e) => eventLocalDate(e) === targetDate),
        ...events.filter((e) => eventLocalDate(e) !== targetDate),
      ]
    : events;
  for (const event of ordered) {
    if (!isRecord(event)) continue;
    const evEmbedded = isRecord(event["_embedded"]) ? event["_embedded"] : {};
    const names = asArray(evEmbedded["attractions"])
      .filter(isRecord)
      .map((a) => asString(a["name"]))
      .filter(Boolean);
    if (names.length === 0) continue;

    const venueData = asArray(evEmbedded["venues"]).filter(isRecord)[0] ?? {};
    const city = isRecord(venueData["city"]) ? venueData["city"] : {};
    const state = isRecord(venueData["state"]) ? venueData["state"] : {};
    const venue = [
      asString(venueData["name"]),
      asString(city["name"]),
      asString(state["name"]),
    ]
      .filter(Boolean)
      .join(", ");

    const lower = artistName.toLowerCase();
    const lineup = playingOrder(names, artistName);

    const eventName = asString(event["name"]);
    let tourName = "";
    for (const sep of [": ", " - "]) {
      if (eventName.toLowerCase().startsWith(lower + sep)) {
        tourName = eventName.slice(artistName.length + sep.length);
        break;
      }
    }
    return { lineup, venue, tourName, eventDate: eventLocalDate(event) };
  }
  return null;
}

/** Find the lineup for an artist's show on eventDate (YYYY-MM-DD, ±1 day). */
export async function getLineup(
  artistName: string,
  eventDate: string,
  apiKey: string,
  fetchFn: FetchFn = fetch,
): Promise<Lineup | null> {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(eventDate);
  if (!m) throw new Error(`eventDate must be YYYY-MM-DD, got ${eventDate}`);
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const day = 24 * 60 * 60 * 1000;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    keyword: artistName,
    classificationName: "music",
    startDateTime: `${iso(target - day)}T00:00:00Z`,
    endDateTime: `${iso(target + day)}T23:59:59Z`,
    apikey: apiKey,
    size: "5",
  });
  const resp = await fetchFn(`${BASE}/events.json?${params.toString()}`);
  if (resp.status === 401) throw new Error("Invalid Ticketmaster API key.");
  if (!resp.ok) throw new Error(`Ticketmaster returned HTTP ${resp.status}`);
  return parseLineup(await resp.json(), artistName, eventDate);
}
