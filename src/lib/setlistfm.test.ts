import { describe, expect, it } from "vitest";
import {
  extractSongs,
  getMostRecentSetlist,
  parseSetlistDate,
} from "./setlistfm";

const rawSetlist = {
  id: "abc123",
  eventDate: "01-06-2026",
  url: "https://www.setlist.fm/setlist/x",
  venue: { name: "Arena", city: { name: "Berlin", country: { name: "Germany" } } },
  sets: {
    set: [
      {
        song: [
          { name: "Intro", tape: true },
          { name: "Creeping Death" },
          { name: "Am I Evil?", cover: { name: "Diamond Head" } },
          { name: "  " },
        ],
      },
      { encore: 1, song: [{ name: "Enter Sandman" }] },
    ],
  },
};

describe("extractSongs", () => {
  it("keeps order across sets/encores and cover/tape metadata, drops blanks", () => {
    expect(extractSongs(rawSetlist)).toEqual([
      { title: "Intro", originalArtist: null, tape: true },
      { title: "Creeping Death", originalArtist: null, tape: false },
      { title: "Am I Evil?", originalArtist: "Diamond Head", tape: false },
      { title: "Enter Sandman", originalArtist: null, tape: false },
    ]);
  });
});

describe("parseSetlistDate", () => {
  it("parses DD-MM-YYYY into a comparable number", () => {
    expect(parseSetlistDate("01-06-2026")).toBe(20260601);
    expect(parseSetlistDate("2026-06-01")).toBeNull();
  });
});

describe("getMostRecentSetlist", () => {
  it("skips shows on/after the cutoff and returns the latest earlier show", async () => {
    const future = { ...rawSetlist, id: "future", eventDate: "05-06-2026" };
    const onDate = { ...rawSetlist, id: "ondate", eventDate: "03-06-2026" };
    const fetchFn = (async () =>
      new Response(JSON.stringify({ setlist: [future, onDate, rawSetlist] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    const result = await getMostRecentSetlist("Metallica", "2026-06-03", "key", fetchFn);
    expect(result?.setlistId).toBe("abc123");
    expect(result?.venue).toBe("Arena");
    expect(result?.city).toBe("Berlin");
  });

  it("returns null on 404", async () => {
    const fetchFn = (async () =>
      new Response("", { status: 404 })) as unknown as typeof fetch;
    expect(
      await getMostRecentSetlist("Nobody", "2026-06-03", "key", fetchFn),
    ).toBeNull();
  });
});
