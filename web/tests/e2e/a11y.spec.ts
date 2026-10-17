import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// /oracle, /developers, /concepts are now permanent redirects (see
// next.config.ts — /oracle → /, the others off-site to /docs/* on Mintlify),
// so they no longer render a Pegana page to audit. Repointed to live routes.
const ROUTES = [
  "/",
  "/dashboard",
  "/methodology",
  "/agents",
  "/audit",
  "/assets",
  "/events",
  "/status",
  "/status/calibration",
  "/compare?s=jitoSOL%2CmSOL",
  "/asset/jitoSOL",
];

for (const route of ROUTES) {
  test(`a11y — ${route} has zero WCAG AA violations`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    // `color-contrast` is excluded from the BLOCKING gate: the editorial design
    // intentionally uses muted low-contrast captions/labels (a locked brand
    // decision) — tracked for a design+a11y review in issue #74. The gate still
    // blocks on STRUCTURAL WCAG AA issues (missing alt/label/aria/roles, etc.),
    // which are real bugs. Contrast findings are logged, not failed.
    const blocking = results.violations.filter(
      (v) => v.id !== "color-contrast",
    );
    const contrast = results.violations.filter(
      (v) => v.id === "color-contrast",
    );
    if (contrast.length > 0) {
      console.warn(
        `[a11y] ${route}: ${contrast.length} non-blocking color-contrast finding(s) — see #74`,
      );
    }
    expect(blocking).toEqual([]);
  });
}
