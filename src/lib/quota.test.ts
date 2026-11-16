import { describe, expect, it } from "vitest";
import { isQuotaError, pacificDate } from "./quota";

describe("pacificDate", () => {
  it("uses America/Los_Angeles calendar date", () => {
    // 2026-11-16T07:30Z is still Nov 15 in PST (UTC-8)
    expect(pacificDate(new Date("2026-11-16T07:30:00Z"))).toBe("2026-11-15");
    expect(pacificDate(new Date("2026-11-16T08:30:00Z"))).toBe("2026-11-16");
  });
});

describe("isQuotaError", () => {
  it("detects YouTube 429 quota failures", () => {
    expect(isQuotaError(new Error("YouTube API failed: HTTP 429 Quota exceeded"))).toBe(true);
    expect(isQuotaError(new Error("HTTP 500"))).toBe(false);
  });
});
