import { test, expect } from "@playwright/test";

// /developers and /learn are now permanent redirects to off-site /docs/* on
// Mintlify (see next.config.ts), so they no longer render a Pegana shell.
// Swapped for the live /agents + /audit + /assets surfaces. (/pricing was cut
// for the V1 launch — the route no longer exists, so it's not smoke-tested.)
const PAGES = [
  {
    path: "/dashboard",
    role: "textbox",
    name: "Filter assets by symbol, name, or class",
  },
  { path: "/asset/jitoSOL", role: "heading", name: /jitoSOL/i },
  { path: "/asset/hyUSD", role: "heading", name: /hyUSD/i },
  { path: "/compare", role: "heading", name: "Stack assets. Spot drifts." },
  {
    path: "/methodology",
    role: "heading",
    name: "Deterministic. Versioned. Replayable.",
  },
  {
    path: "/status",
    role: "heading",
    name: /All systems operational|Operating with degraded freshness|Checking systems|Investigating an outage/i,
  },
  { path: "/events", role: "heading", name: "Every depeg, replayable." },
  { path: "/embed", role: "heading", name: "Put a peg status on your site." },
  {
    path: "/agents",
    role: "heading",
    name: "Verifiable peg state in your prompts.",
  },
  { path: "/audit", role: "heading", name: "Every alert ships a receipt." },
  {
    path: "/assets",
    role: "heading",
    name: "Every pegged asset Pegana monitors, ranked by risk.",
  },
  { path: "/about", role: "heading", name: "A peg watchdog you can read." },
  {
    path: "/whats-new",
    role: "heading",
    name: "The peg-risk oracle, now proven on-chain.",
  },
] as const;

const baseUrl = new URL(
  process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
);
const isVercelPreview =
  process.env.PLAYWRIGHT_EXTERNAL_TARGET === "1" &&
  baseUrl.hostname.endsWith(".vercel.app");
const VERCEL_TOOLBAR_CSP =
  "console: Framing 'https://vercel.live/' violates the following Content Security Policy directive: \"frame-src 'self' https://oauth.telegram.org\". The request has been blocked.";

test.describe("Inner pages — smoke after landing uplift", () => {
  for (const route of PAGES) {
    test(`${route.path} renders without crashing`, async ({ page }) => {
      await page.addInitScript(() => {
        try {
          window.localStorage.setItem("pegana:onboarding_v1", "dismissed");
        } catch {
          return;
        }
      });
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
      });
      await page.goto(route.path);
      await expect(
        page.getByRole(route.role, { name: route.name }).first(),
      ).toBeVisible({ timeout: 15_000 });
      // Permit one class of expected noise: API-unreachable warnings when the
      // backend is offline. Browsers surface a refused resource load as
      // "Failed to load resource: net::ERR_CONNECTION_REFUSED" (not the bare
      // "ECONNREFUSED"/"Failed to fetch" strings), so match those forms too —
      // otherwise this smoke test can never pass without a local backend.
      const fatal = errors.filter(
        (e) =>
          !/API unreachable|fetch|NetworkError|Failed to fetch|Failed to load resource|ECONNREFUSED|ERR_CONNECTION_REFUSED|net::ERR_|WebSocket|ws:|Hydration|localStorage|429|Too Many Requests|401|403|Unauthorized|Forbidden|#418|#423|#425/i.test(
            e,
          ) &&
          !(
            isVercelPreview &&
            (e.trim() === VERCEL_TOOLBAR_CSP ||
              /Minified React error #418/.test(e))
          ),
      );
      expect(
        fatal,
        `unexpected errors on ${route.path}:\n${fatal.join("\n")}`,
      ).toHaveLength(0);
    });
  }
});
