import { publishTourToYouTube } from "./publish";
import { publishTourToSpotify } from "./publishSpotify";
import { buildShow } from "./shows";
import { importTourStops, listTourStops } from "./tours";

export const MCP_TOOLS = [
  {
    name: "build_show",
    description:
      "Build a concert show: lineup (Ticketmaster) + recent/predicted/actual setlists (setlist.fm), saved to SetReady.",
    inputSchema: {
      type: "object",
      properties: {
        headliner: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
        bands: { type: "array", items: { type: "string" }, description: "Playing order, opener first" },
        mode: { type: "string", enum: ["last_show", "predicted", "actual"] },
      },
      required: ["headliner", "date"],
    },
  },
  {
    name: "import_tour_stops",
    description: "Import/refresh all Ticketmaster stops for a tour slug.",
    inputSchema: {
      type: "object",
      properties: { tourSlug: { type: "string" } },
      required: ["tourSlug"],
    },
  },
  {
    name: "publish_tour",
    description:
      "Publish or update in place the canonical tour playlist on YouTube Music or Spotify.",
    inputSchema: {
      type: "object",
      properties: {
        tourSlug: { type: "string" },
        service: { type: "string", enum: ["youtube", "spotify"] },
      },
      required: ["tourSlug", "service"],
    },
  },
  {
    name: "tour_status",
    description: "Tour stops, lineup, and published playlists for a tour slug.",
    inputSchema: {
      type: "object",
      properties: { tourSlug: { type: "string" } },
      required: ["tourSlug"],
    },
  },
] as const;

export interface McpEnv {
  DB: D1Database;
  SETLISTFM_API_KEY: string;
  TICKETMASTER_API_KEY?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
}

async function callTool(env: McpEnv, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === "build_show") {
    const mode =
      args["mode"] === "predicted" || args["mode"] === "actual" ? args["mode"] : "last_show";
    const built = await buildShow(
      env.DB,
      {
        headliner: String(args["headliner"] ?? ""),
        date: String(args["date"] ?? ""),
        bands: Array.isArray(args["bands"]) ? args["bands"].map(String) : undefined,
        mode,
      },
      { setlistfm: env.SETLISTFM_API_KEY, ticketmaster: env.TICKETMASTER_API_KEY },
    );
    return {
      slug: built.slug, tourSlug: built.tourSlug, title: built.title,
      bands: built.bands.map((b) => ({ band: b.band, songs: b.setlist?.songs.length ?? 0 })),
    };
  }
  if (name === "import_tour_stops") {
    if (!env.TICKETMASTER_API_KEY) throw new Error("ticketmaster_not_configured");
    const tourSlug = String(args["tourSlug"] ?? "");
    const tour = await env.DB.prepare("SELECT id FROM tours WHERE slug = ?")
      .bind(tourSlug).first<{ id: number }>();
    if (!tour) throw new Error(`tour not found: ${tourSlug}`);
    return importTourStops(env.DB, tour.id, env.TICKETMASTER_API_KEY);
  }
  if (name === "publish_tour") {
    const tourSlug = String(args["tourSlug"] ?? "");
    if (args["service"] === "spotify") {
      if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) throw new Error("spotify_not_configured");
      return publishTourToSpotify(env.DB, tourSlug, env.SPOTIFY_CLIENT_ID, env.SPOTIFY_CLIENT_SECRET);
    }
    if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) throw new Error("google_oauth_not_configured");
    return publishTourToYouTube(env.DB, tourSlug, env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET);
  }
  if (name === "tour_status") {
    const tourSlug = String(args["tourSlug"] ?? "");
    const tour = await env.DB.prepare(
      "SELECT id, slug, title, tour_name FROM tours WHERE slug = ?",
    ).bind(tourSlug).first<{ id: number; slug: string; title: string; tour_name: string }>();
    if (!tour) throw new Error(`tour not found: ${tourSlug}`);
    const { results: playlists } = await env.DB.prepare(
      "SELECT DISTINCT service, external_url FROM published_playlists WHERE tour_id = ?",
    ).bind(tour.id).all();
    return { tour, stops: await listTourStops(env.DB, tour.id), playlists };
  }
  throw new Error(`unknown tool: ${name}`);
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

/** Stateless Streamable-HTTP-style MCP handler (JSON responses). */
export async function handleMcp(
  body: JsonRpcRequest,
  env: McpEnv,
  isAuthorized: boolean,
): Promise<{ status: number; payload: unknown | null }> {
  const id = body.id ?? null;
  const ok = (result: unknown) => ({ status: 200, payload: { jsonrpc: "2.0", id, result } });
  const fail = (code: number, message: string) => ({
    status: 200,
    payload: { jsonrpc: "2.0", id, error: { code, message } },
  });

  if (body.method === "initialize") {
    return ok({
      protocolVersion: String(body.params?.["protocolVersion"] ?? "2025-03-26"),
      capabilities: { tools: {} },
      serverInfo: { name: "setready", version: "0.1.0" },
    });
  }
  if (body.method === "ping") return ok({});
  if (body.method === "tools/list") return ok({ tools: MCP_TOOLS });
  if (body.method === "tools/call") {
    if (!isAuthorized) return fail(-32001, "admin_required: send x-admin-token header");
    const name = String(body.params?.["name"] ?? "");
    const args = (body.params?.["arguments"] ?? {}) as Record<string, unknown>;
    try {
      const result = await callTool(env, name, args);
      return ok({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result });
    } catch (err) {
      return ok({
        isError: true,
        content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
      });
    }
  }
  if (id === null) return { status: 202, payload: null }; // notification
  return fail(-32601, `method not found: ${body.method}`);
}
