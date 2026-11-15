import { describe, expect, it } from "vitest";
import { chooseSpotifyCandidate, spotifyDescription } from "./publishSpotify";
import type { TrackHit } from "./spotify";

const hit = (over: Partial<TrackHit>): TrackHit => ({
  uri: "spotify:track:1",
  id: "1",
  name: "Creeping Death",
  artists: "Metallica",
  artistNames: ["Metallica"],
  ...over,
});

describe("spotifyDescription", () => {
  it("stays within Spotify's 300-character cap", () => {
    const d = spotifyDescription({
      tourName: "CROWN IN THE GRAVE WORLD TOUR",
      bandsInPlayingOrder: ["Frozen Soul", "Orbit Culture", "In Flames", "Trivium"],
      stops: Array.from({ length: 20 }, (_, i) => ({
        event_date: `2026-12-${String(i + 1).padStart(2, "0")}`,
        venue: "Some Arena, Springfield, Somestate",
      })),
    });
    expect(d.length).toBeLessThanOrEqual(300);
    expect(d).toContain("Frozen Soul → Orbit Culture");
  });
});

describe("chooseSpotifyCandidate", () => {
  it("prefers the exact studio title over a live version", () => {
    const live = hit({ uri: "spotify:track:live", id: "live", name: "Creeping Death - Live" });
    const studio = hit({});
    expect(
      chooseSpotifyCandidate([live, studio], "Metallica", "Creeping Death", new Set())?.uri,
    ).toBe("spotify:track:1");
  });

  it("requires an artist match and never reuses a URI", () => {
    const wrong = hit({ artists: "Tribute Band", artistNames: ["Tribute Band"] });
    expect(
      chooseSpotifyCandidate([wrong], "Metallica", "Creeping Death", new Set()),
    ).toBeNull();
    expect(
      chooseSpotifyCandidate([hit({})], "Metallica", "Creeping Death", new Set(["spotify:track:1"])),
    ).toBeNull();
  });
});
