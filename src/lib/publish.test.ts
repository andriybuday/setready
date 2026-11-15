import { describe, expect, it } from "vitest";
import {
  chooseCandidate,
  matchArtist,
  playlistDescription,
  publishableSongs,
  type ShowSongRow,
} from "./publish";
import { playlistTitle } from "./shows";

const row = (over: Partial<ShowSongRow>): ShowSongRow => ({
  artist_name: "Metallica",
  title: "One",
  normalized_title: "one",
  original_artist: null,
  is_tape: 0,
  included: 1,
  ...over,
});

describe("publishableSongs", () => {
  it("drops tape intros and excluded songs", () => {
    const rows = [
      row({ title: "Intro", is_tape: 1 }),
      row({ title: "One" }),
      row({ title: "Skip", included: 0 }),
    ];
    expect(publishableSongs(rows).map((r) => r.title)).toEqual(["One"]);
  });
});

describe("matchArtist", () => {
  it("uses the original artist for covers", () => {
    expect(matchArtist(row({ original_artist: "Diamond Head" }))).toBe("Diamond Head");
    expect(matchArtist(row({}))).toBe("Metallica");
  });
});

describe("chooseCandidate", () => {
  const live = {
    videoId: "live1",
    title:
      "Frozen Soul - Dallas 2025 - Absolute Zero + Arsenal of War + Invoke War - Live at Granada Theater",
    channelTitle: "Some Fan",
  };
  const topic = {
    videoId: "topic1",
    title: "Arsenal of War",
    channelTitle: "Frozen Soul - Topic",
  };

  it("prefers Topic audio over a live medley containing the title", () => {
    expect(
      chooseCandidate([live, topic], "Frozen Soul", "Arsenal of War", new Set())
        ?.videoId,
    ).toBe("topic1");
  });

  it("prefers an official label video over the live medley", () => {
    const official = {
      videoId: "off1",
      title: "FROZEN SOUL - Arsenal Of War (feat. Reese Alavi) (OFFICIAL VIDEO)",
      channelTitle: "Century Media Records",
    };
    expect(
      chooseCandidate([live, official], "Frozen Soul", "Arsenal of War", new Set())
        ?.videoId,
    ).toBe("off1");
  });

  it("never reuses a video already in the playlist (YouTube 409 duplicate)", () => {
    expect(
      chooseCandidate([topic], "Frozen Soul", "Arsenal of War", new Set(["topic1"])),
    ).toBeNull();
  });

  it("rejects titles that do not contain the song title", () => {
    expect(
      chooseCandidate(
        [{ videoId: "x", title: "Something Else", channelTitle: "Frozen Soul - Topic" }],
        "Frozen Soul",
        "Arsenal of War",
        new Set(),
      ),
    ).toBeNull();
  });
});

describe("playlistDescription", () => {
  it("sells provenance with playing order, venue, and an honesty caveat", () => {
    const d = playlistDescription({
      tourName: "CROWN IN THE GRAVE WORLD TOUR",
      bandsInPlayingOrder: ["Frozen Soul", "Orbit Culture", "In Flames", "Trivium"],
      stops: [
        {
          slug: "trivium-2026-12-08",
          event_date: "2026-12-08",
          venue: "UBC - Doug Mitchell Thunderbird Sports Centre, Vancouver, British Columbia",
        },
      ],
    });
    expect(d).toContain("Hear the show before doors — at every stop on this tour.");
    expect(d).toContain("real setlists");
    expect(d).toContain("sourced from setlist.fm");
    expect(d).toContain("Frozen Soul → Orbit Culture → In Flames → Trivium");
    expect(d).toContain("• 2026-12-08 — UBC - Doug Mitchell");
    expect(d).toContain("not a guarantee");
    expect(d).not.toContain("verified");
  });
});

describe("playlistTitle", () => {
  it("matches the prototype naming convention", () => {
    expect(playlistTitle(["Metallica"], "", "2026")).toBe("Metallica 2026");
    expect(playlistTitle(["Mammoth WVH", "Metallica"], "M72 World Tour", "2026")).toBe(
      "M72 World Tour — Mammoth WVH & Metallica 2026",
    );
    expect(playlistTitle(["A", "B", "C"], "", "2026")).toBe("A, B & C 2026");
  });
});
