import { describe, expect, it } from "vitest";
import { FOLLOWED_ARTISTS, hasFollowedArtist, isFollowedArtist } from "./followedArtists";

describe("followed artists", () => {
  it("contains the operator's 32 followed artists", () => {
    expect(FOLLOWED_ARTISTS).toHaveLength(32);
    expect(isFollowedArtist("LINKIN PARK")).toBe(true);
    expect(isFollowedArtist("Gorillaz")).toBe(true);
    expect(isFollowedArtist("Metallica")).toBe(false);
  });

  it("matches a followed support act anywhere on the bill", () => {
    expect(hasFollowedArtist(["Unknown Opener", "Orbit Culture", "Headliner"])).toBe(true);
    expect(hasFollowedArtist(["Unknown Opener", "Headliner"])).toBe(false);
  });
});
