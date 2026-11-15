import { describe, expect, it } from "vitest";
import { parseLineup, parseTourEvents } from "./ticketmaster";

const response = {
  _embedded: {
    events: [
      {
        name: "Metallica: M72 World Tour",
        _embedded: {
          attractions: [{ name: "Metallica" }, { name: "Mammoth WVH" }],
          venues: [
            { name: "Big Arena", city: { name: "Denver" }, state: { name: "Colorado" } },
          ],
        },
      },
    ],
  },
};

describe("parseLineup playing order", () => {
  it("reverses billing order into playing order for multi-support bills", () => {
    const bill = {
      _embedded: {
        events: [
          {
            name: "Trivium",
            _embedded: {
              attractions: [
                { name: "Trivium" },
                { name: "In Flames" },
                { name: "Frozen Soul" },
                { name: "Orbit Culture" },
              ],
              venues: [{ name: "Arena", city: { name: "Penticton" } }],
            },
          },
        ],
      },
    };
    expect(parseLineup(bill, "Trivium")?.lineup).toEqual([
      "Orbit Culture",
      "Frozen Soul",
      "In Flames",
      "Trivium",
    ]);
  });
});

describe("parseTourEvents", () => {
  it("dedupes same date+city keeping the richest attraction listing", () => {
    const ev = (id: string, attractions: string[]) => ({
      id,
      dates: { start: { localDate: "2026-12-03" } },
      _embedded: {
        attractions: attractions.map((name) => ({ name })),
        venues: [{ name: "Pearl", city: { name: "Las Vegas" }, state: { name: "Nevada" } }],
      },
    });
    const data = {
      _embedded: {
        events: [ev("sparse", ["Trivium"]), ev("full", ["Trivium", "In Flames", "Frozen Soul", "Orbit Culture"])],
      },
    };
    const out = parseTourEvents(data, "Trivium");
    expect(out).toHaveLength(1);
    expect(out[0]?.ticketmasterEventId).toBe("full");
    expect(out[0]?.lineup).toEqual(["Orbit Culture", "Frozen Soul", "In Flames", "Trivium"]);
  });
});

describe("parseLineup", () => {
  it("orders support first, headliner last, with venue and tour name", () => {
    expect(parseLineup(response, "Metallica")).toEqual({
      lineup: ["Mammoth WVH", "Metallica"],
      venue: "Big Arena, Denver, Colorado",
      tourName: "M72 World Tour",
      eventDate: "",
    });
  });

  it("prefers the event on the exact target date over an adjacent tour stop", () => {
    const ev = (localDate: string, venue: string) => ({
      name: "Trivium",
      dates: { start: { localDate } },
      _embedded: {
        attractions: [{ name: "Trivium" }, { name: "In Flames" }],
        venues: [{ name: venue, city: { name: "X" } }],
      },
    });
    const multi = {
      _embedded: {
        events: [ev("2026-12-07", "Penticton"), ev("2026-12-08", "Vancouver")],
      },
    };
    const hit = parseLineup(multi, "Trivium", "2026-12-08");
    expect(hit?.venue).toContain("Vancouver");
    expect(hit?.eventDate).toBe("2026-12-08");
  });

  it("returns null when there are no events", () => {
    expect(parseLineup({}, "Metallica")).toBeNull();
  });
});
