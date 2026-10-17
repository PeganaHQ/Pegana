import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The console host must never be indexable (docs/strategy/2026-10-17-www-app-split.md §2).
// Two independent mechanisms enforce that, and both are exercised here:
//   1. the proxy sets `X-Robots-Tag: noindex` on every console-host response,
//      so the rule holds at the host level without each page repeating it, and
//   2. app/robots.ts answers the console host with `Disallow: /`.
// A regression in either silently re-exposes the whole console to crawlers, so
// these are behavioural tests, not source greps.

const hdr = vi.hoisted(() => ({ host: "app.pegana.xyz" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: hdr.host }),
}));

import robots from "@/app/robots";
import { proxy } from "@/proxy";

const WWW = "www.pegana.xyz";
const APEX = "pegana.xyz";
const APP = "app.pegana.xyz";

function request(host: string, path: string): NextRequest {
  return new NextRequest(`https://${host}${path}`, {
    headers: { host },
  });
}

beforeEach(() => {
  hdr.host = APP;
});

describe("proxy — X-Robots-Tag on the console host", () => {
  it("marks console pages noindex", () => {
    for (const path of [
      "/dashboard",
      "/assets",
      "/compare",
      "/events",
      "/systemic",
    ]) {
      const res = proxy(request(APP, path));
      expect(res.status, path).toBe(200);
      expect(res.headers.get("x-robots-tag"), path).toBe("noindex");
    }
  });

  it("does NOT mark the marketing host noindex", () => {
    for (const path of ["/", "/lst", "/methodology", "/asset/USDC"]) {
      const res = proxy(request(WWW, path));
      expect(res.status, path).toBe(200);
      expect(res.headers.get("x-robots-tag"), path).toBeNull();
    }
  });

  it("does NOT mark previews noindex (the split is off there)", () => {
    const res = proxy(request("pegana-abc.vercel.app", "/dashboard"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBeNull();
  });
});

describe("proxy — no cross-host redirects", () => {
  it("serves console paths on www instead of redirecting them", () => {
    for (const path of ["/dashboard", "/assets", "/compare", "/events"]) {
      const res = proxy(request(WWW, path));
      expect(res.status, path).toBe(200);
      expect(res.headers.get("location"), path).toBeNull();
    }
  });

  it("serves marketing paths on the app host instead of redirecting", () => {
    for (const path of ["/", "/lst", "/methodology"]) {
      const res = proxy(request(APP, path));
      expect(res.status, path).toBe(200);
      expect(res.headers.get("location"), path).toBeNull();
    }
  });

  it("still canonicalises the apex to www", () => {
    const res = proxy(request(APEX, "/about"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://www.pegana.xyz/about");
  });
});

describe("robots.ts — host-aware", () => {
  it("disallows the console host entirely and advertises no sitemap", async () => {
    hdr.host = APP;
    const out = await robots();
    expect(out.rules).toEqual([{ userAgent: "*", disallow: "/" }]);
    expect(out.sitemap).toBeUndefined();
  });

  it("keeps the marketing policy on www", async () => {
    hdr.host = WWW;
    const out = await robots();
    const rule = Array.isArray(out.rules) ? out.rules[0] : out.rules;
    expect(rule).toMatchObject({
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/monitoring"],
    });
    expect(out.sitemap).toBe("https://www.pegana.xyz/sitemap.xml");
  });

  it("keeps the marketing policy on the apex", async () => {
    hdr.host = APEX;
    const out = await robots();
    const rule = Array.isArray(out.rules) ? out.rules[0] : out.rules;
    expect(rule).toMatchObject({ allow: "/" });
  });
});

describe("proxy source guard", () => {
  it("gates X-Robots-Tag on the routing decision's noindex flag", () => {
    // A source guard, deliberately: the behavioural tests above prove the
    // header appears today, and this pins that it stays tied to the routing
    // decision rather than being hardcoded on or dropped.
    const src = readFileSync(join(process.cwd(), "proxy.ts"), "utf8");
    expect(src).toMatch(/if \(hostPolicy\.noindex\) \{[\s\S]*?X-Robots-Tag/);
  });
});
