import { describe, expect, it } from "vitest";
import { classifyTourStops, lineupFingerprint, tourSlug } from "./tours";
import type { TourEvent } from "./ticketmaster";

describe("lineupFingerprint", () => {
  it("is order-independent for the same band set", () => {
    expect(lineupFingerprint(["Frozen Soul", "Orbit Culture", "Trivium"])).toBe(
      lineupFingerprint(["Trivium", "Frozen Soul", "Orbit Culture"]),
    );
  });

  it("differs when the band set differs (different tour leg)", () => {
    expect(lineupFingerprint(["Frozen Soul", "Trivium"])).not.toBe(
      lineupFingerprint(["Orbit Culture", "Trivium"]),
    );
  });
});

describe("classifyTourStops", () => {
  const ev = (eventDate: string, lineup: string[]): TourEvent => ({
    eventDate, venue: "V", city: "C", region: "", country: "",
    ticketmasterEventId: eventDate, lineup, attractionCount: lineup.length,
  });
  const bands = ["Frozen Soul", "Orbit Culture", "In Flames", "Trivium"];

  it("confirms exact sets, infers sparse subsets inside the range, excludes other legs", () => {
    const out = classifyTourStops(
      [
        ev("2026-11-18", ["Frozen Soul", "Fit for an Autopsy", "In Flames", "Trivium"]),
        ev("2026-11-20", bands),
        ev("2026-12-08", ["In Flames", "Trivium"]),
        ev("2026-12-19", bands),
      ],
      bands,
      "Trivium",
    );
    expect(out.map((s) => [s.eventDate, s.confidence])).toEqual([
      ["2026-11-20", "confirmed"],
      ["2026-12-08", "inferred"],
      ["2026-12-19", "confirmed"],
    ]);
  });
});

describe("tourSlug", () => {
  it("uses the tour name and year", () => {
    expect(
      tourSlug("CROWN IN THE GRAVE WORLD TOUR", "Trivium", "2026", ["Trivium"]),
    ).toMatch(/^crown-in-the-grave-world-tour-2026-/);
  });
});
