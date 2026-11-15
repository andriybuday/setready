import { describe, expect, it } from "vitest";
import { lineupFingerprint, tourSlug } from "./tours";

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

describe("tourSlug", () => {
  it("uses the tour name and year", () => {
    expect(
      tourSlug("CROWN IN THE GRAVE WORLD TOUR", "Trivium", "2026", ["Trivium"]),
    ).toMatch(/^crown-in-the-grave-world-tour-2026-/);
  });
});
