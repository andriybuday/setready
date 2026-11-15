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

    // Ticketmaster lists attractions in billing order (headliner, then
    // biggest support, down to opener). Playing order is the reverse:
    // opener first, headliner last.
    const lower = artistName.toLowerCase();
    const headliner = names.find((n) => n.toLowerCase() === lower);
    const lineup = headliner
      ? [
          ...names.filter((n) => n.toLowerCase() !== lower).reverse(),
          headliner,
        ]
      : [...names].reverse();

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
