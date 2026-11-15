import { describe, expect, it } from "vitest";
import { parseSearchHit, spotifyAuthUrl, SPOTIFY_SCOPES } from "./spotify";

describe("spotifyAuthUrl", () => {
  it("requests the publisher scopes with a code flow", () => {
    const url = new URL(
      spotifyAuthUrl("cid", "http://127.0.0.1:8787/oauth/spotify/callback"),
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(SPOTIFY_SCOPES.join(" "));
  });
});

describe("parseSearchHit", () => {
  it("extracts uri/name/artists from the first search item", () => {
    const data = {
      tracks: {
        items: [
          {
            uri: "spotify:track:abc",
            id: "abc",
            name: "Creeping Death",
            artists: [{ name: "Metallica" }],
          },
        ],
      },
    };
    expect(parseSearchHit(data)).toEqual({
      uri: "spotify:track:abc",
      id: "abc",
      name: "Creeping Death",
      artists: "Metallica",
      artistNames: ["Metallica"],
    });
  });

  it("returns null for empty results", () => {
    expect(parseSearchHit({ tracks: { items: [] } })).toBeNull();
  });
});
