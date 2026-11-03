/**
 * Shared developer connection endpoints for in-app MCP Settings and onboarding.
 * Keep cloud and self-hosted installations isolated: never send the key or
 * OAuth traffic of a self-hosted installation to the managed PostSider cloud.
 */
export const SELF_HOSTED = process.env.NEXT_PUBLIC_SELF_HOSTED === "true";

export const API_URL =
  process.env.NEXT_PUBLIC_PUBLIC_API_URL ||
  (SELF_HOSTED
    ? (process.env.NEXT_PUBLIC_BACKEND_URL || "").replace(/\/+$/, "")
    : "https://api.postsider.com");

function defaultMcpUrl(): string {
  if (!SELF_HOSTED) return "https://mcp.postsider.com/mcp";
  try {
    const url = new URL(process.env.NEXT_PUBLIC_BACKEND_URL || "");
    const host = url.hostname.replace(/^[^.]+\./, "");
    return `${url.protocol}//mcp.${host || url.hostname}/mcp`;
  } catch {
    return "https://mcp.example.com/mcp";
  }
}

export const MCP_URL = process.env.NEXT_PUBLIC_MCP_URL || defaultMcpUrl();
