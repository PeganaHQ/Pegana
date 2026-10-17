import { test, expect } from "@playwright/test";

// /developers and /learn are now permanent redirects to off-site /docs/* on
// Mintlify (see next.config.ts) — repointed to the live /agents + /audit
// surfaces, with landmarks taken from their always-rendered hero copy.
const PAGES = [
  { path: "/methodology", landmark: /pipeline|methodology|Two numbers/i },
  { path: "/status", landmark: /operational|systems|status/i },
  { path: "/events", landmark: /heatmap|replayable|event/i },
  { path: "/embed", landmark: /Specimen|preview|embed/i },
  // Match the visible hero <h1>, not the global marquee (its hidden duplicate
  // span also contains "MCP" and would win .first()). The <h1> splits the line
  // with a <br/> ("…peg state<br/>in your prompts"), so the DOM text content
  // has no space across the break — match only the contiguous first half.
  { path: "/agents", landmark: /Verifiable peg state/i },
  { path: "/audit", landmark: /audit ledger|receipt|verify|alert/i },
  { path: "/about", landmark: /watchdog|reach out|About|Working on/i },
];

test.describe("Inner pages — landmarks", () => {
  for (const p of PAGES) {
    test(`${p.path} renders landmark`, async ({ page }) => {
      await page.goto(p.path, { waitUntil: "domcontentloaded" });
      await expect(page.locator("body")).toContainText(p.landmark, {
        timeout: 10000,
      });
    });
  }
});

test.describe("Inner pages — mobile 390 no overflow", () => {
  for (const p of PAGES) {
    test(`${p.path} no horizontal scroll at 390`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(p.path, { waitUntil: "domcontentloaded" });
      await expect(page.locator("body")).toContainText(p.landmark, {
        timeout: 10000,
      });
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(
        overflow.clientWidth + 2,
      );
    });
  }
});
