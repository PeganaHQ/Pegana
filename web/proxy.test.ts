import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "./proxy";

// Regression guard for the CSP proxy matcher.
//
// The proxy attaches the strict nonce + 'strict-dynamic' Content-Security-Policy
// to every matched HTML request. Paths that render third-party HTML we cannot
// nonce (or non-HTML hot paths) MUST stay excluded, otherwise the policy blocks
// their assets.
//
// /docs is NO LONGER proxied — it is a permanent Vercel redirect to
// docs.pegana.xyz (web/vercel.json), so it never reaches the Next.js proxy.

const source = config.matcher[0]!.source;
const matcher = new RegExp(`^${source}$`);

describe("proxy CSP matcher", () => {
  it.each(["/api/csp-report", "/embed/telegram-login", "/monitoring"])(
    "keeps the pre-existing exclusion %s",
    (path) => {
      expect(matcher.test(path)).toBe(false);
    },
  );

  it.each(["/", "/dashboard", "/assets", "/asset/USDC", "/audit"])(
    "still applies CSP to first-party app route %s",
    (path) => {
      expect(matcher.test(path)).toBe(true);
    },
  );
});

describe("apex host", () => {
  /**
   * pegana.xyz rendered as unstyled HTML, and the cause was a split origin.
   *
   * vercel.json's apex→www redirect covers `/:path*` and fires for assets, but
   * never for the document: this middleware answers document requests first,
   * while `_next/` is excluded from its matcher and falls through to
   * vercel.json. So the HTML came from pegana.xyz with `style-src 'self'`, and
   * every stylesheet it referenced 308'd to www.pegana.xyz — a different
   * origin, which `'self'` does not cover. CSP refused every one of them.
   *
   * Measured on production before the fix: 3 <link rel=stylesheet> present,
   * document.styleSheets inaccessible, body background transparent, h1 at the
   * browser default 32px.
   *
   * The guarantee is that the apex NEVER SERVES the document itself — it always
   * 308s to whichever host owns the path (marketing or console), so `'self'`
   * on the served document always matches the origin serving its assets.
   */
  it("redirects a marketing document to www so the origin never splits", () => {
    const res = proxy(
      new NextRequest("https://pegana.xyz/lst?tab=history", {
        headers: { host: "pegana.xyz" },
      }),
    );
    expect(res.status).toBe(308);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.host).toBe("www.pegana.xyz");
    expect(loc.pathname).toBe("/lst");
    expect(loc.search).toBe("?tab=history");
  });

  it("sends a product document to www too — everything is public now", () => {
    // Pegana is fully open, so /dashboard is an ordinary public page on www.
    // The apex still canonicalises (so the origin never splits) but it no
    // longer routes product paths to a second host.
    const res = proxy(
      new NextRequest("https://pegana.xyz/dashboard?tab=history", {
        headers: { host: "pegana.xyz" },
      }),
    );
    expect(res.status).toBe(308);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.host).toBe("www.pegana.xyz");
    expect(loc.pathname).toBe("/dashboard");
    expect(loc.search).toBe("?tab=history");
  });

  it("redirects before attaching a CSP, so no split-origin policy is ever sent", () => {
    const res = proxy(
      new NextRequest("https://pegana.xyz/", { headers: { host: "pegana.xyz" } }),
    );
    expect(res.status).toBe(308);
    expect(res.headers.get("content-security-policy")).toBeNull();
  });

  it("leaves www alone", () => {
    const res = proxy(
      new NextRequest("https://www.pegana.xyz/", {
        headers: { host: "www.pegana.xyz" },
      }),
    );
    expect(res.status).not.toBe(308);
    expect(res.headers.get("content-security-policy")).toBeTruthy();
  });

  it("lets the served document load token and partner logos from the API box", () => {
    const res = proxy(
      new NextRequest("https://www.pegana.xyz/", {
        headers: { host: "www.pegana.xyz" },
      }),
    );
    const csp = res.headers.get("content-security-policy") ?? "";
    const imgSrc = csp.match(/img-src ([^;]+)/)?.[1]?.split(" ") ?? [];
    expect(imgSrc).toContain("https://api.pegana.xyz");
  });
});

describe("proxy matcher skips static files", () => {
  it.each([
    "/tokens/J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn.webp",
    "/logos/sanctum.svg",
    "/brand/pegana-wave-chroma.svg",
    "/apple-touch-icon.png",
    "/android-chrome-192x192.png",
    "/manifest.webmanifest",
    "/asset/xSOL/opengraph-image-94vvyq",
    "/asset/USDC/twitter-image-94vvyq",
    "/audit/abc/opengraph-image-1x2y3z",
    "/asset/USDC/share-card",
    "/compare/share",
  ])("does not run the proxy for %s", (path) => {
    expect(matcher.test(path)).toBe(false);
  });

  it.each([
    "/asset/jitoSOL",
    "/lst",
    "/releases",
    "/pegana-replay-installer.sh",
    "/compare",
    "/audit/abc",
  ])(
    "still runs for %s",
    (path) => {
      expect(matcher.test(path)).toBe(true);
    },
  );
});
