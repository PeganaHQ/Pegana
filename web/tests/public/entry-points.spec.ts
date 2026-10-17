import { expect, test, type Page } from "@playwright/test";

/**
 * Every public way into Pegana, checked against the live production surface.
 *
 * WHY THIS EXISTS
 *
 * `pegana.xyz` served raw unstyled HTML in production and nothing caught it,
 * because every check in this repo — 234 passing E2E tests included — asked for
 * `www.pegana.xyz`. The apex is what a person types.
 *
 * The failure was a split origin. The middleware answered the document on the
 * apex while `_next/` fell through to vercel.json's apex->www redirect, so the
 * HTML came from `pegana.xyz` carrying `style-src 'self'` while every stylesheet
 * it referenced 308'd to `www.pegana.xyz`. A different origin. CSP refused all
 * of them and the page rendered as unstyled markup.
 *
 * Two lessons are encoded here, and both were learned the expensive way:
 *
 * 1. A 200 proves nothing. The broken page returned 200, with three <link> tags
 *    the browser had refused to load. Only "did CSS actually apply" catches it.
 * 2. The host list is enumerated, not remembered. Writing this from memory
 *    produced five hosts; grepping the repo found six. The one missed by recall
 *    is exactly the kind that rots unnoticed.
 *
 * KEEP `PUBLIC_HOSTS` IN SYNC. Adding a hostname anywhere (DNS, vercel.json,
 * proxy.ts) means adding it here. A host absent from this table is a host
 * nothing tests.
 */

/** Hosts serving the Next app, whose documents carry the strict CSP. */
const PRIMARY = "https://www.pegana.xyz";
const APEX = "https://pegana.xyz";
const RELEASES = "https://releases.pegana.xyz";

type Expectation =
  | { kind: "redirects-to"; target: string }
  | { kind: "serves-app" }
  | { kind: "responds-ok"; path: string };

const PUBLIC_HOSTS: Array<{ host: string; role: string; expect: Expectation }> =
  [
    {
      host: APEX,
      role: "what a human types; must hand off to the primary host",
      expect: { kind: "redirects-to", target: `${PRIMARY}/` },
    },
    {
      host: PRIMARY,
      role: "the console and marketing site",
      expect: { kind: "serves-app" },
    },
    {
      host: RELEASES,
      role: "CLI release surface, its own branch in proxy.ts",
      expect: { kind: "serves-app" },
    },
    {
      host: "https://api.pegana.xyz",
      role: "the Rust API on Hetzner",
      // Unversioned on purpose: /v1/health does not exist and returns 404.
      expect: { kind: "responds-ok", path: "/health" },
    },
    {
      host: "https://docs.pegana.xyz",
      role: "Mintlify docs, also proxied at /docs",
      expect: { kind: "responds-ok", path: "/introduction" },
    },
    {
      host: "https://mcp.pegana.xyz",
      role: "MCP server, x402-metered",
      expect: { kind: "responds-ok", path: "/" },
    },
  ];

/** Routes that must render styled from every app-serving entry point. */
const APP_ROUTES = ["/", "/dashboard", "/asset/jitoSOL"];

async function measureStyling(page: Page) {
  return page.evaluate(() => {
    let rules = 0;
    let unreadableSheet = false;
    try {
      for (const sheet of document.styleSheets) {
        rules += sheet.cssRules?.length ?? 0;
      }
    } catch {
      // Reading cssRules throws for a cross-origin sheet. On a same-origin app
      // that means a stylesheet loaded from somewhere it should not have.
      unreadableSheet = true;
      rules = -1;
    }
    return {
      origin: location.origin,
      cssRules: rules,
      unreadableSheet,
      // The canvas token. Unstyled HTML leaves this transparent.
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      stylesheetLinks: document.querySelectorAll('link[rel="stylesheet"]')
        .length,
    };
  });
}

test.describe("public entry points", () => {
  for (const entry of PUBLIC_HOSTS) {
    test(`${entry.host} — ${entry.role}`, async ({ request }) => {
      if (entry.expect.kind === "redirects-to") {
        const res = await request.get(`${entry.host}/`, {
          maxRedirects: 0,
        });
        expect(res.status(), "apex must redirect, not answer").toBe(308);
        expect(res.headers()["location"]).toBe(entry.expect.target);

        // The redirect must carry no CSP. If it does, the policy was attached
        // before the host handoff, which is the bug that broke the apex.
        expect(res.headers()["content-security-policy"]).toBeUndefined();

        // Path and query survive the hop, or every deep link into the apex
        // silently lands on the homepage.
        const deep = await request.get(`${entry.host}/asset/jitoSOL?tab=audit`, {
          maxRedirects: 0,
        });
        expect(deep.headers()["location"]).toBe(
          `${PRIMARY}/asset/jitoSOL?tab=audit`,
        );
        return;
      }

      const path = entry.expect.kind === "responds-ok" ? entry.expect.path : "/";
      const res = await request.get(`${entry.host}${path}`);
      expect(res.status(), `${entry.host}${path} must be reachable`).toBeLessThan(
        400,
      );
    });
  }

  // The real assertion. Everything above proves a host answers; this proves the
  // answer is a usable page.
  for (const origin of [APEX, PRIMARY, RELEASES]) {
    for (const route of APP_ROUTES) {
      // The releases surface only serves its own index.
      if (origin === RELEASES && route !== "/") continue;

      test(`${origin}${route} renders styled`, async ({ page }) => {
        const refused: string[] = [];
        page.on("console", (msg) => {
          const text = msg.text();
          if (
            /Refused to (load|apply)|violates the following Content Security/i.test(
              text,
            )
          ) {
            refused.push(text.slice(0, 200));
          }
        });

        await page.addInitScript(() => {
          try {
            window.localStorage.setItem("pegana:onboarding_v1", "dismissed");
          } catch {
            /* private mode — the modal just stays up, harmless here */
          }
        });

        await page.goto(`${origin}${route}`, { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("networkidle").catch(() => {
          // A live WS connection keeps the network busy. The styling assertions
          // below do not depend on idle, so a timeout here is not a failure.
        });

        const m = await measureStyling(page);

        // The document and its assets must share an origin, so `'self'` in the
        // CSP covers the stylesheets the document references.
        if (origin !== RELEASES) {
          expect(m.origin, "apex must have handed off to the primary host").toBe(
            PRIMARY,
          );
        }

        // CSS actually applied. The broken page passed every check but these.
        expect(m.stylesheetLinks).toBeGreaterThan(0);
        expect(m.unreadableSheet).toBe(false);
        expect(m.cssRules).toBeGreaterThan(50);
        expect(m.bodyBackground).not.toBe("rgba(0, 0, 0, 0)");
        expect(m.bodyBackground).not.toBe("transparent");

        // Nothing refused by the policy, on any resource type.
        expect(refused, "CSP refused a resource").toEqual([]);
      });
    }
  }
});
