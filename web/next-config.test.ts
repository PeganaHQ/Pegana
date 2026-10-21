import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

const DOCS_ORIGIN = "https://docs.pegana.xyz";

describe("legacy documentation redirects", () => {
  it("sends every legacy docs route directly to the docs subdomain", async () => {
    const redirects = await nextConfig.redirects!();
    const legacySources = [
      "/concepts",
      "/concepts/:slug",
      "/learn",
      "/learn/:slug",
      "/developers",
      "/developers/examples",
      "/developers/:path*",
      "/changelog",
      "/feed/changelog.xml",
    ];

    const legacy = redirects.filter((redirect) =>
      legacySources.includes(redirect.source),
    );

    expect(legacy).toHaveLength(legacySources.length);
    for (const redirect of legacy) {
      expect(redirect.permanent).toBe(true);
      expect(new URL(redirect.destination).origin).toBe(DOCS_ORIGIN);
      expect(redirect.destination.startsWith("/docs")).toBe(false);
    }
  });
});

describe("static asset and header hygiene", () => {
  it("caches vendored token and partner logos instead of max-age=0", async () => {
    const headers = await nextConfig.headers!();
    for (const source of ["/tokens/:path*", "/logos/:path*"]) {
      const rule = headers.find((h) => h.source === source);
      const cc = rule?.headers.find((h) => h.key === "Cache-Control")?.value;
      expect(cc).toMatch(/max-age=86400/);
    }
  });
  it("does not advertise X-Powered-By", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
  it("lets the optimizer fetch only CoinGecko article images, no query string", () => {
    const patterns = nextConfig.images?.remotePatterns ?? [];
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({
      protocol: "https",
      hostname: "assets.coingecko.com",
      pathname: "/articles/images/**",
      search: "",
    });
  });
});

describe("HSTS", () => {
  it("covers every path with includeSubDomains and a two-year max-age", async () => {
    const headers = await nextConfig.headers!();
    const rule = headers.find((h) => h.source === "/:path*");
    const v = rule?.headers.find((h) => h.key === "Strict-Transport-Security")?.value;
    expect(v).toBe("max-age=63072000; includeSubDomains");
    expect(v).not.toMatch(/preload/);
  });
});

describe("Hobby CDN request budget", () => {
  // Every request that reaches Vercel counts against the Hobby plan's 1M CDN
  // requests a month, browser-cache hits do not. These files were served with
  // max-age=0, so every full page load revalidated them (measured 2026-10-21:
  // 2 of the 3-4 requests a returning visitor makes per page).
  const ICONS = [
    "/brand/:path*",
    "/favicon.ico",
    "/favicon.svg",
    "/favicon-16x16.png",
    "/favicon-32x32.png",
    "/apple-touch-icon.png",
    "/android-chrome-192x192.png",
    "/android-chrome-512x512.png",
    "/icon-maskable-512x512.png",
  ];

  it("lets browsers cache the root icons and brand art for a day", async () => {
    const headers = await nextConfig.headers!();
    for (const source of ICONS) {
      const rule = headers.find((h) => h.source === source);
      const cc = rule?.headers.find((h) => h.key === "Cache-Control")?.value;
      expect(cc, source).toBe(
        "public, max-age=86400, stale-while-revalidate=604800",
      );
    }
  });

  it("covers only files that exist in public/, so no rule is dead", async () => {
    const { existsSync } = await import("node:fs");
    const path = await import("node:path");
    for (const source of ICONS.filter((s) => !s.includes(":"))) {
      expect(existsSync(path.join(__dirname, "public", source)), source).toBe(
        true,
      );
    }
  });

  it("merges client chunks so a first visit makes fewer requests", () => {
    const chunking = nextConfig.experimental?.turbopackChunking;
    expect(chunking).toBeDefined();
    // Defaults are 40 chunks per group, 50 KB minimum, 200 KB request cost.
    expect(chunking!.maxChunkCountPerGroup).toBeLessThanOrEqual(4);
    expect(chunking!.minChunkSize).toBeGreaterThanOrEqual(200_000);
    expect(chunking!.requestCost).toBeGreaterThanOrEqual(2_000_000);
  });
});
