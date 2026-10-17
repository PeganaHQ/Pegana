import { expect, test } from "@playwright/test";

/**
 * Per-page contracts that only production can prove, and that unit tests
 * structurally cannot: how many network requests a real page makes, and
 * whether the rendered document has a heading.
 *
 * Both checks exist because something shipped broken while a suite that
 * covered the exact same page reported green.
 */

/**
 * Defaults to production. Override to check a preview BEFORE merging, which is
 * the only build signal this repo has (`next build` is banned locally):
 *
 *   PEGANA_APP_ORIGIN=https://pegana-<hash>-<team>.vercel.app bun run verify:public
 */
const SITE = process.env.PEGANA_APP_ORIGIN ?? "https://www.pegana.xyz";

/** Every routed app page, with the <h1> each must render. */
const ROUTES = [
  "/",
  "/dashboard",
  "/assets",
  "/asset/jitoSOL",
  "/events",
  "/lst",
  "/compare",
  "/systemic",
  "/status",
  "/methodology",
];

test.describe("page contracts", () => {
  for (const route of ROUTES) {
    test(`${route} renders exactly one <h1>`, async ({ page }) => {
      // `/dashboard` shipped with NO <h1> at all. Its heading was
      // DashboardVerdict's headline, which the 2026-07-14 hover-not-click
      // rebuild moved inside a Radix HoverCard — and Radix does not mount
      // hover-card content until it opens, so the heading was absent rather
      // than hidden.
      //
      // tests/e2e/a11y.spec.ts runs axe against this very route, but scopes to
      // wcag2a/wcag2aa/wcag21a/wcag21aa, and axe tags `page-has-heading-one`
      // as best-practice. So the a11y gate covered the page and could not see
      // the defect. Asserting it directly does not depend on a tag set.
      await page.addInitScript(() => {
        try {
          window.localStorage.setItem("pegana:onboarding_v1", "dismissed");
        } catch {
          /* private mode; the modal stays up but the DOM still has its h1 */
        }
      });
      await page.goto(`${SITE}${route}`, { waitUntil: "domcontentloaded" });

      const h1 = page.locator("h1");
      await expect(h1).toHaveCount(1);
      // Present but empty is the same failure wearing a tag.
      await expect(h1).not.toBeEmpty();
    });
  }

  test("a single homepage load stays inside the API rate-limit budget", async ({
    page,
  }) => {
    // The hero board drew a "Spread · 30d" sparkline by calling
    // useAssetSparkline -> useHistory30d PER ROW, which paged up to 10 windows
    // of 5000 one-minute buckets PER ASSET, then downsampled the result to 48
    // points. Measured on production: 68 API requests for one homepage load,
    // 65 of them /history?limit=5000.
    //
    // api.pegana.xyz allows 300 requests/min per IP, so roughly 4.4 homepage
    // views a minute from a single IP — an office, CGNAT, a mobile carrier,
    // or this repo's own parallel test workers — started getting 429s. The
    // failure was invisible: the cell just renders "-" with no error.
    //
    // The board now reads the `series_24h` already inline on /v1/assets, so
    // the sparkline costs zero requests of its own.
    const apiRequests: string[] = [];
    page.on("request", (r) => {
      const url = r.url();
      if (url.includes("api.pegana.xyz")) apiRequests.push(url);
    });

    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("pegana:onboarding_v1", "dismissed");
      } catch {
        /* no-op */
      }
    });
    await page.goto(`${SITE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(9_000);

    const history = apiRequests.filter((u) => u.includes("/history"));

    // The homepage has no business fetching per-asset history at all.
    expect(
      history,
      `homepage fetched ${history.length} /history requests; it should use the inline series_24h`,
    ).toEqual([]);

    // Generous ceiling: the page legitimately needs /v1/assets and /v1/stats
    // plus revalidation. It does NOT need dozens. The point is to fail loudly
    // if per-row fetching reappears, not to pin an exact number.
    expect(
      apiRequests.length,
      `homepage made ${apiRequests.length} API requests: ${apiRequests.slice(0, 5).join(", ")}`,
    ).toBeLessThan(15);
  });
});
