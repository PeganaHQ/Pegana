import { test, expect } from "@playwright/test";

// Audit ledger e2e — updated for current V2 audit page copy and receipt detail layout.
// Previous assertions expected H1 "Every alert ships a receipt you can verify yourself."
// and detail headings "Methodology" / "Computed" — all superseded.

test.describe("Audit ledger", () => {
  test("index loads with table, calibration view, or empty state", async ({
    page,
  }) => {
    await page.goto("/audit", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /Every alert ships a receipt/i }),
    ).toBeVisible();

    const hasRows = (await page.locator("table tbody tr").count()) > 0;
    const hasEmpty =
      (await page
        .getByText(/calibration|unreachable|no.*alert|What the feed will show/i)
        .count()) > 0;
    expect(hasRows || hasEmpty).toBe(true);
  });

  test("?state=DRIFT narrows H1 and updates filter UI", async ({ page }) => {
    await page.goto("/audit?state=DRIFT", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/Recent alerts in DRIFT/i)).toBeVisible();
    await expect(
      page.getByRole("link", { name: /clear filter/i }),
    ).toBeVisible();
  });

  test("?state=GARBAGE silently falls back to default (defense in depth)", async ({
    page,
  }) => {
    await page.goto("/audit?state=GARBAGE", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/Recent alerts in GARBAGE/i)).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: /Every alert ships a receipt/i }),
    ).toBeVisible();
  });

  test("detail page for unknown UUID renders the not-found surface gracefully", async ({
    page,
  }) => {
    const response = await page.goto("/audit/00000000-0000-0000-0000-000000000000");
    expect(response?.status()).toBe(404);

    // Stable landmark from the receipt-specific not-found component
    // (app/(marketing)/audit/[id]/not-found.tsx → ErrorSurfaceV2). Prefer the
    // real copy rendered by that component over generic role selectors so a
    // different not-found page would not satisfy this assertion.
    await expect(
      page.getByRole("heading", { name: "No receipt under that ID." }),
    ).toBeVisible();

    const has500 = await page
      .getByText(/internal error|something went wrong/i)
      .count();
    expect(has500).toBe(0);
  });

  test("detail page renders for a real alert_id", async ({ page }) => {
    test.skip(
      !process.env.PEGANA_SAMPLE_ALERT_ID,
      "set PEGANA_SAMPLE_ALERT_ID to enable",
    );
    const id = process.env.PEGANA_SAMPLE_ALERT_ID!;
    const response = await page.goto(`/audit/${id}`);
    expect(response?.status()).toBe(200);

    // Stable, receipt-specific landmarks (app/(marketing)/audit/[id]/page.tsx):
    //   • breadcrumb renders the requested id's first 8 chars
    //   • PageHeroV2 eyebrow is the literal "Receipt" for every detail page
    // A generic Next not-found fallback would render neither, so this is a
    // stronger assertion than the previous "first <table> visible" check.
    await expect(
      page.getByText(id.slice(0, 8), { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator("p.font-mono", { hasText: /^Receipt$/ }).first(),
    ).toBeVisible();
    // The receipt container is still rendered (defence against a wholesale
    // layout regression elsewhere on the page).
    await expect(page.locator("table").first()).toBeVisible({ timeout: 8000 });
  });
});
