import { test, expect } from "@playwright/test";

// Exit Liquidity regression — closes B-001 (Jupiter v6 → v1).
// Before the fix, the proxy at /api/jupiter-quote called the deprecated
// Jupiter v6 endpoint, which returned 404 for every request. The UI rendered
// "Unavailable" in all 3 size rows on every non-USDC asset page.
//
// This spec asserts the happy path: at desktop width, at least one size row
// renders a numeric USDC amount within 15s. If the proxy regresses to v6
// (or any other failing upstream), the assertion fails fast.

test.describe("Exit liquidity — Jupiter quotes", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("desktop: jitoSOL shows a real USDC quote (not Unavailable)", async ({
    page,
  }) => {
    await page.goto("/asset/jitoSOL");
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 10_000 });
    if (
      await page.getByText(/Live feed unreachable|API responded 429/i).count()
    ) {
      test.skip(
        true,
        "live API unavailable/rate-limited; exit liquidity cannot resolve",
      );
    }
    await page
      .getByRole("heading", { name: /^exit liquidity$/i })
      .scrollIntoViewIfNeeded();

    // Wait until either a quote row settles or the 15s budget elapses.
    // The smoothed/loading state shows "Fetching…"; we want anything past it.
    const quoteRow = page.locator("text=/^\\$(\\d|<)/");
    await expect(quoteRow.first()).toBeVisible({ timeout: 15_000 });

    // No row should still be in the failed "Unavailable" state.
    const unavailable = page.getByText(/Unavailable/);
    await expect(unavailable).toHaveCount(0);
  });

  test("USDC asset shows 'no swap needed' empty state", async ({ page }) => {
    await page.goto("/asset/USDC");
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 10_000 });
    if (
      await page.getByText(/Live feed unreachable|API responded 429/i).count()
    ) {
      test.skip(
        true,
        "live API unavailable/rate-limited; exit liquidity cannot resolve",
      );
    }
    await page
      .getByRole("heading", { name: /^exit liquidity$/i })
      .scrollIntoViewIfNeeded();
    await expect(page.getByText(/no swap needed/i)).toBeVisible({
      timeout: 10_000,
    });
  });
});
