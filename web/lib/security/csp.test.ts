import { describe, it, expect } from "vitest";
import { buildCsp, buildCspForEnv } from "./csp";

const FAKE_NONCE = "dGVzdC1ub25jZS0xMjM0NTY="; // base64("test-nonce-123456")

describe("buildCsp", () => {
  it("interpolates the nonce into script-src", () => {
    const csp = buildCsp(FAKE_NONCE);
    expect(csp).toContain(`'nonce-${FAKE_NONCE}'`);
  });

  it("includes 'strict-dynamic' in script-src", () => {
    const csp = buildCsp(FAKE_NONCE);
    const scriptSrc = csp.match(/script-src ([^;]+)/)?.[1] ?? "";
    expect(scriptSrc).toContain("'strict-dynamic'");
  });

  it("includes object-src 'none'", () => {
    expect(buildCsp(FAKE_NONCE)).toContain("object-src 'none'");
  });

  it("includes base-uri 'self'", () => {
    expect(buildCsp(FAKE_NONCE)).toContain("base-uri 'self'");
  });

  it("includes frame-ancestors 'none'", () => {
    expect(buildCsp(FAKE_NONCE)).toContain("frame-ancestors 'none'");
  });

  it("excludes telegram.org from script-src (login widget removed)", () => {
    const csp = buildCsp(FAKE_NONCE);
    const scriptSrc = csp.match(/script-src ([^;]+)/)?.[1] ?? "";
    expect(scriptSrc).not.toContain("telegram.org");
  });

  it("includes va.vercel-scripts.com in script-src (for Vercel Analytics)", () => {
    const csp = buildCsp(FAKE_NONCE);
    const scriptSrc = csp.match(/script-src ([^;]+)/)?.[1] ?? "";
    expect(scriptSrc).toContain("https://va.vercel-scripts.com");
  });

  it("keeps frame-src same-origin only (no third-party frames)", () => {
    const csp = buildCsp(FAKE_NONCE);
    const frameSrc = csp.match(/frame-src ([^;]+)/)?.[1] ?? "";
    expect(frameSrc).toBe("'self'");
  });

  it("includes *.sentry.io in connect-src (Sentry ingest)", () => {
    const csp = buildCsp(FAKE_NONCE);
    const connectSrc = csp.match(/connect-src ([^;]+)/)?.[1] ?? "";
    expect(connectSrc).toContain("https://*.sentry.io");
  });

  it("includes api.pegana.xyz in connect-src (REST API)", () => {
    const csp = buildCsp(FAKE_NONCE);
    const connectSrc = csp.match(/connect-src ([^;]+)/)?.[1] ?? "";
    expect(connectSrc).toContain("https://api.pegana.xyz");
  });

  it("includes wss://api.pegana.xyz in connect-src (WebSocket feed)", () => {
    const csp = buildCsp(FAKE_NONCE);
    const connectSrc = csp.match(/connect-src ([^;]+)/)?.[1] ?? "";
    expect(connectSrc).toContain("wss://api.pegana.xyz");
  });

  it("includes worker-src 'self' blob: (Sentry Replay + same-origin workers)", () => {
    expect(buildCsp(FAKE_NONCE)).toContain("worker-src 'self' blob:");
  });

  it("includes form-action 'self' (Firefox does not inherit it from default-src)", () => {
    expect(buildCsp(FAKE_NONCE)).toContain("form-action 'self'");
  });

  it("includes report-uri /api/csp-report", () => {
    expect(buildCsp(FAKE_NONCE)).toContain("report-uri /api/csp-report");
  });

  it("produces a single-line string (no embedded newlines)", () => {
    expect(buildCsp(FAKE_NONCE)).not.toMatch(/\n/);
  });

  it("is stable: same nonce produces the same output", () => {
    expect(buildCsp(FAKE_NONCE)).toBe(buildCsp(FAKE_NONCE));
  });
});

describe("buildCspForEnv", () => {
  it("does not include unsafe-eval in the production output", () => {
    // NODE_ENV is 'test' in vitest (not 'development'), so buildCspForEnv
    // should behave identically to buildCsp.
    const csp = buildCspForEnv(FAKE_NONCE);
    expect(csp).not.toContain("'unsafe-eval'");
  });
});

// ── CSP-scope regression: embed exclusion guard ───────────────────────────────
//
// The proxy's `embed/` exclusion is LOAD-BEARING: badge routes (/embed/[asset],
// /embed/badge/*) set their OWN `frame-ancestors *` CSP so they stay
// cross-origin embeddable. If someone drops `embed/` from the proxy matcher,
// the proxy's `frame-ancestors 'none'` overwrites those headers, silently
// breaking every third-party embed without a visible CI failure.
//
// This block snapshots that invariant so the drop fails CI.

import { config } from "../../proxy";

describe("proxy CSP matcher: embed exclusion regression", () => {
  const source = config.matcher[0]!.source;
  const matcher = new RegExp(`^${source}$`);

  it("EXCLUDES /embed/ paths so badge routes can set their own frame-ancestors *", () => {
    expect(matcher.test("/embed/USDC")).toBe(false);
    expect(matcher.test("/embed/badge/USDC")).toBe(false);
    expect(matcher.test("/embed/badge/jitoSOL")).toBe(false);
    expect(matcher.test("/embed/telegram-login")).toBe(false);
  });

  it("main buildCsp() still emits frame-ancestors 'none' (main site protection)", () => {
    const csp = buildCsp(FAKE_NONCE);
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("buildCsp() frame-ancestors 'none' is NOT frame-ancestors * (never weaken site CSP)", () => {
    const csp = buildCsp(FAKE_NONCE);
    // Extract just the frame-ancestors directive
    const frameAncestors = csp.match(/frame-ancestors ([^;]+)/)?.[1] ?? "";
    // Must be exactly 'none', never '*' or any host pattern
    expect(frameAncestors.trim()).toBe("'none'");
  });

  it("still applies CSP to first-party routes like /audit", () => {
    expect(matcher.test("/audit")).toBe(true);
    expect(matcher.test("/asset/USDC")).toBe(true);
    expect(matcher.test("/dashboard")).toBe(true);
  });
});
