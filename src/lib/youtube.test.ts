import { describe, expect, it } from "vitest";
import { musicPlaylistUrl, playlistUrl, youtubeAuthUrl, YOUTUBE_SCOPE } from "./youtube";

describe("youtubeAuthUrl", () => {
  it("requests offline access with the force-ssl scope", () => {
    const url = new URL(
      youtubeAuthUrl("client-123", "http://127.0.0.1:8787/oauth/youtube/callback"),
    );
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("scope")).toBe(YOUTUBE_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("response_type")).toBe("code");
  });
});

describe("playlist urls", () => {
  it("builds YouTube and YouTube Music URLs for the same playlist", () => {
    expect(playlistUrl("PLabc")).toBe("https://www.youtube.com/playlist?list=PLabc");
    expect(musicPlaylistUrl("PLabc")).toBe(
      "https://music.youtube.com/playlist?list=PLabc",
    );
  });
});
