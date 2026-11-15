import { describe, expect, it } from "vitest";
import { isoDatePlus, tracklistHash } from "./automation";

describe("tracklistHash", () => {
  it("changes when a song changes and is stable for the same list", () => {
    const a = [{ artist: "Trivium", title: "Rain" }];
    const b = [{ artist: "Trivium", title: "Strife" }];
    expect(tracklistHash(a)).toBe(tracklistHash([...a]));
    expect(tracklistHash(a)).not.toBe(tracklistHash(b));
  });
});

describe("isoDatePlus", () => {
  it("crosses month boundaries", () => {
    expect(isoDatePlus("2026-12-30", 5)).toBe("2027-01-04");
    expect(isoDatePlus("2026-12-08", -7)).toBe("2026-12-01");
  });
});
