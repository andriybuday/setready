import { describe, expect, it } from "vitest";
import { normalizeName, showSlug } from "./normalize";

describe("normalizeName", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeName("Guns N' Roses")).toBe("guns n roses");
  });

  it("strips accents", () => {
    expect(normalizeName("Motörhead")).toBe("motorhead");
  });

  it("drops a leading The", () => {
    expect(normalizeName("The Cure")).toBe("cure");
  });

  it("treats & as and", () => {
    expect(normalizeName("Simon & Garfunkel")).toBe("simon and garfunkel");
  });
});

describe("showSlug", () => {
  it("builds a dated slug", () => {
    expect(showSlug("Metallica", "2026-06-01")).toBe("metallica-2026-06-01");
  });
});
