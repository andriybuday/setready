import { describe, expect, it } from "vitest";
import { predictSetlist } from "./predict";
import type { RecentSetlist } from "./setlistfm";

const show = (titles: string[]): RecentSetlist => ({
  songs: titles.map((title) => ({ title, originalArtist: null, tape: false })),
  date: "01-01-2026", venue: "V", city: "C", country: "X", url: "", setlistId: "1",
});

describe("predictSetlist", () => {
  it("keeps staples, orders by average position, reports rotation probability", () => {
    const out = predictSetlist([
      show(["Opener", "Staple", "Rotation A", "Closer"]),
      show(["Opener", "Staple", "Rotation B", "Closer"]),
      show(["Opener", "Staple", "Rotation A", "Closer"]),
      show(["Opener", "Staple", "Rotation A", "Closer"]),
    ]);
    expect(out.map((s) => s.title)).toEqual(["Opener", "Staple", "Rotation A", "Closer"]);
    expect(out[2]?.probability).toBeCloseTo(0.75);
    expect(out[0]?.openRate).toBe(1);
    expect(out[3]?.closeRate).toBe(1);
  });

  it("returns empty for no shows", () => {
    expect(predictSetlist([])).toEqual([]);
  });
});
