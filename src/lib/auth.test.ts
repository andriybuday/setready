import { describe, expect, it } from "vitest";
import { authorizeAdmin, requiresAdmin, timingSafeEqual } from "./auth";

const req = (method: string, path: string, headers: Record<string, string> = {}) =>
  new Request(`https://example.test${path}`, { method, headers });

describe("authorizeAdmin", () => {
  it("fails closed when no token is configured", () => {
    expect(authorizeAdmin(req("POST", "/api/shows/build"), undefined)).toEqual({
      ok: false, status: 503, error: "admin_not_configured",
    });
  });

  it("accepts x-admin-token and Bearer, rejects wrong/missing", () => {
    expect(authorizeAdmin(req("POST", "/api/x", { "x-admin-token": "s3cret" }), "s3cret").ok).toBe(true);
    expect(authorizeAdmin(req("POST", "/api/x", { authorization: "Bearer s3cret" }), "s3cret").ok).toBe(true);
    expect(authorizeAdmin(req("POST", "/api/x", { "x-admin-token": "nope" }), "s3cret")).toEqual({
      ok: false, status: 401, error: "admin_required",
    });
    expect(authorizeAdmin(req("POST", "/api/x"), "s3cret").ok).toBe(false);
  });
});

describe("requiresAdmin", () => {
  it("covers mutations under /api only", () => {
    expect(requiresAdmin(req("POST", "/api/shows/build"))).toBe(true);
    expect(requiresAdmin(req("GET", "/api/shows"))).toBe(false);
    expect(requiresAdmin(req("GET", "/shows/x"))).toBe(false);
  });
});

describe("timingSafeEqual", () => {
  it("compares exact strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});
