// Hono Web Standard transport for the MCP server.
//
// Uses WebStandardStreamableHTTPServerTransport from the SDK — the
// Bun/Cloudflare-Workers/Deno-friendly transport (the Node one wraps
// this). Stateless: one transport per request, no sessions in v2.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer, initSharedState } from "@/server";
import { renderProm } from "@/metrics";
import { TOOL_CATALOG, toolCountSummary } from "@/pricing";
import packageMetadata from "../package.json";

// Static landing HTML served on GET / so browser visitors see a useful
// page (not 404). Kept inline because mcp-ts has no view layer and we
// don't want a templating dep just for one page. Self-contained styles;
// CSP allows only inline styles, no scripts/images/iframes.
const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Pegana MCP — Peg-risk oracle for Solana agents</title>
<meta name="robots" content="index, follow" />
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 48px 24px; min-height: 100vh;
    background: #0a0a0a; color: #fafafa;
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  main { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 28px; margin: 0 0 4px; letter-spacing: -0.02em; }
  h2 { font-size: 16px; margin: 32px 0 12px; color: #a1a1aa;
       font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }
  p { color: #d4d4d8; margin: 0 0 12px; }
  small { color: #71717a; }
  code { font-family: 'SF Mono', Menlo, Consolas, monospace;
         font-size: 13px; background: #18181b; padding: 1px 6px;
         border-radius: 3px; color: #e4e4e7; }
  pre { background: #18181b; padding: 16px; border-radius: 6px;
        overflow-x: auto; margin: 0 0 12px; border: 1px solid #27272a;
        font-family: 'SF Mono', Menlo, Consolas, monospace;
        font-size: 13px; line-height: 1.55; }
  a { color: #fafafa; text-decoration: underline;
      text-decoration-color: #52525b; text-underline-offset: 3px; }
  a:hover { text-decoration-color: #fafafa; }
  ul { padding-left: 18px; margin: 0 0 12px; color: #d4d4d8; }
  li { margin-bottom: 4px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 3px;
           background: #18181b; border: 1px solid #27272a;
           font-size: 11px; color: #a1a1aa; font-family: 'SF Mono', Menlo, monospace;
           text-transform: uppercase; letter-spacing: 0.05em; }
  footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid #27272a;
           color: #71717a; font-size: 13px; }
</style>
</head>
<body>
<main>
  <span class="badge">MCP endpoint</span>
  <h1>Pegana MCP server</h1>
  <p><small>The peg-risk oracle for Solana DeFi — over MCP, for agents.</small></p>

  <h2>What this URL is</h2>
  <p>This is a <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener">Model Context Protocol</a>
     endpoint. It speaks JSON-RPC over HTTP <code>POST</code>, not a website.
     If you reached it via a browser, you're in the wrong place — visit
     <a href="https://pegana.xyz/agents">pegana.xyz/agents</a> for the integration guide.</p>

  <h2>Tools available</h2>
  <p>${toolCountSummary()}. No payment, no API key.</p>
  <ul>
${TOOL_CATALOG.map(
  (t) =>
    `    <li><code>${t.name}</code> &middot; ${t.price} &middot; ${t.description}</li>`,
).join("\n")}
  </ul>

  <h2>Hello world</h2>
  <pre>curl -X POST https://mcp.pegana.xyz/ \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: application/json, text/event-stream' \\
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'</pre>

  <h2>Wire into Claude / Cursor / Codex</h2>
  <pre>{
  "mcpServers": {
    "pegana": {
      "url": "https://mcp.pegana.xyz/"
    }
  }
}</pre>

  <h2>Health + metrics</h2>
  <ul>
    <li><code>GET /health</code> &rarr; liveness</li>
    <li><code>GET /metrics</code> &rarr; Prometheus exposition</li>
  </ul>

  <footer>
    <a href="https://pegana.xyz/agents">Integration guide</a> &middot;
    <a href="https://pegana.xyz/methodology">Methodology</a> &middot;
    <a href="https://github.com/PeganaHQ/ReplayCLI">Source (verifier CLI)</a> &middot;
    <a href="https://t.me/PeganaWatchBot">Telegram</a>
  </footer>
</main>
</body>
</html>`;

export async function buildApp(): Promise<Hono> {
  const app = new Hono();

  // CORS: the landing page advertises wiring this MCP server into arbitrary
  // clients, so a browser-side/in-browser-agent consumer must be able to POST
  // JSON-RPC + preflight OPTIONS. Without this, OPTIONS 404'd and browser
  // clients were blocked (QA audit 2026-07-23). Server-side clients (Claude
  // Desktop/Code, Cursor) are unaffected either way.
  app.use("*", cors());

  // Warm the shared state (facilitator handshake + payment wrappers) once
  // at boot — the per-request factory is then cheap.
  await initSharedState();

  app.post("/", async (c) => {
    // Build fresh per request — McpServer cannot be connected to two
    // transports concurrently, and the streamable-HTTP transport is
    // request-scoped. The shared state inside createMcpServer() is
    // cached, so this stays cheap.
    const mcp = await createMcpServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    await mcp.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  // GET on / — friendly landing for humans who paste the URL in a browser.
  // The MCP protocol is POST-only JSON-RPC; without this, browser visitors
  // see Hono's default 404 and assume the server is broken (caught during
  // surface audit 2026-05-29).
  app.get("/", (c) => {
    return c.html(LANDING_HTML, 200, {
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    });
  });

  // Machine-readable discovery. The Bazaar extension only reaches PAID tools
  // (it rides on the 402 challenge), so this manifest is where the free tools
  // are advertised, each with an explicit `"free"` price. Prices come from
  // @/pricing — the same source as the x402 requirement — so the manifest
  // cannot advertise a price different from the one charged.
  app.get("/.well-known/mcp.json", (c) =>
    c.json({
      name: "Pegana Oracle MCP",
      version: packageMetadata.version,
      endpoint: "https://mcp.pegana.xyz/",
      transport: "streamable-http",
      documentation: "https://docs.pegana.xyz/guides/mcp",
      privacy: "https://www.pegana.xyz/privacy",
      tools: toolCountSummary(),
      toolList: TOOL_CATALOG,
    }),
  );

  app.get("/health", (c) => c.text("ok"));

  // Prometheus exposition — scraped by the same Grafana stack that
  // already consumes engine-rs / api-rs metrics.
  app.get("/metrics", (c) =>
    c.text(renderProm(), 200, { "content-type": "text/plain; version=0.0.4" }),
  );

  return app;
}
