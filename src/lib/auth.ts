/**
 * Operator gate for mutating endpoints. Public read pages stay open;
 * anything that spends quota or writes to publisher accounts requires
 * the shared ADMIN_TOKEN secret (header `x-admin-token` or Bearer).
 * Fails closed when ADMIN_TOKEN is not configured.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type AuthResult = { ok: true } | { ok: false; status: 401 | 503; error: string };

export function authorizeAdmin(request: Request, adminToken: string | undefined): AuthResult {
  if (!adminToken) return { ok: false, status: 503, error: "admin_not_configured" };
  const header = request.headers.get("x-admin-token") ?? "";
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (timingSafeEqual(header, adminToken) || timingSafeEqual(bearer, adminToken)) {
    return { ok: true };
  }
  return { ok: false, status: 401, error: "admin_required" };
}

/** Paths that change state, spend quota, or write to publisher accounts. */
export function requiresAdmin(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD") return false;
  return new URL(request.url).pathname.startsWith("/api/");
}
