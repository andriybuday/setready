import { describe, expect, it } from "vitest";
import { handleMcp, MCP_TOOLS, type McpEnv } from "./mcp";

const env = { SETLISTFM_API_KEY: "x" } as unknown as McpEnv;

describe("MCP protocol surface", () => {
  it("lists tools and initializes without auth", async () => {
    const init = await handleMcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, env, false);
    expect((init.payload as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe("setready");
    const list = await handleMcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }, env, false);
    expect((list.payload as { result: { tools: unknown[] } }).result.tools).toHaveLength(MCP_TOOLS.length);
  });

  it("refuses tool calls without operator authorization", async () => {
    const res = await handleMcp(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "tour_status", arguments: { tourSlug: "x" } } },
      env, false,
    );
    expect((res.payload as { error: { code: number } }).error.code).toBe(-32001);
  });
});
