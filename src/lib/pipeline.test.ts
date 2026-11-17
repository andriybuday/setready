import { describe, expect, it } from "vitest";
import { groupCandidates } from "./pipeline";
import type { TourEvent } from "./ticketmaster";

const ev = (
  eventDate: string,
  billing: string[],
  city = "X",
  genres = ["Metal"],
): TourEvent => ({
  eventDate, eventName: `${billing[0]}: Big Tour`, venue: "V", city, region: "",
  country: "USA", ticketmasterEventId: eventDate,
  lineup: [...billing].reverse(), billing, genres, attractionCount: billing.length,
});

describe("groupCandidates", () => {
  it("groups repeat dates by headliner + band set and ranks bigger tours first", () => {
    const groups = groupCandidates([
      ev("2026-11-20", ["Trivium", "In Flames", "Frozen Soul"]),
      ev("2026-11-21", ["Trivium", "In Flames", "Frozen Soul"]),
      ev("2026-11-22", ["Trivium", "In Flames", "Frozen Soul"]),
      ev("2026-11-22", ["Solo Act"]),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.headliner).toBe("Trivium");
    expect(groups[0]?.events).toHaveLength(3);
    expect(groups[0]?.tourName).toBe("Big Tour");
    expect(groups[0]?.bandsPlayingOrder).toEqual(["Frozen Soul", "In Flames", "Trivium"]);
    expect(groups[0]?.isHeavyMetal).toBe(true);
  });

  it("ranks a smaller heavy-metal tour ahead of a larger non-metal tour", () => {
    const groups = groupCandidates([
      ev("2026-11-20", ["Pop Act", "Support"], "A", ["Pop"]),
      ev("2026-11-21", ["Pop Act", "Support"], "B", ["Pop"]),
      ev("2026-11-22", ["Pop Act", "Support"], "C", ["Pop"]),
      ev("2026-11-20", ["Metal Act", "Opener"], "D", ["Death Metal/Black Metal"]),
      ev("2026-11-21", ["Metal Act", "Opener"], "E", ["Death Metal/Black Metal"]),
    ]);
    expect(groups[0]?.headliner).toBe("Metal Act");
    expect(groups[0]?.isHeavyMetal).toBe(true);
  });
});
