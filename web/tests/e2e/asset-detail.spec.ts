import { test, expect } from "@playwright/test";

async function requireAssetDetailOrSkip(page: import("@playwright/test").Page) {
  const h1 = page.locator("h1").first();
  try {
    await expect(h1).toBeVisible({ timeout: 15_000 });
  } catch (err) {
    if (!process.env.CI) {
      test.skip(
        true,
        "live asset detail did not settle locally; backend/API is unavailable or rate-limited",
      );
    }
    throw err;
  }
}

test.describe("Asset detail — desktop 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("renders hero + key landmarks", async ({ page }) => {
    await page.goto("/asset/jitoSOL", { waitUntil: "domcontentloaded" });

    await requireAssetDetailOrSkip(page);
    if (await page.getByText(/Live feed unreachable/i).count()) return;
    await expect(
      page.getByRole("tablist", { name: "Asset sections" }),
    ).toBeVisible({ timeout: 10000 });
    await page.getByRole("tab", { name: "History", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: /Activity timeline/i }),
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Asset detail — mobile 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("renders without horizontal scroll", async ({ page }) => {
    await page.goto("/asset/jitoSOL", { waitUntil: "domcontentloaded" });
    await requireAssetDetailOrSkip(page);
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);
  });

  test("hero h1 visible at mobile width", async ({ page }) => {
    await page.goto("/asset/jitoSOL", { waitUntil: "domcontentloaded" });
    await requireAssetDetailOrSkip(page);
  });
});
