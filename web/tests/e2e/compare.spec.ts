import { test, expect } from "@playwright/test";

// These specs intentionally avoid depending on the live API. The /compare
// page hydrates its chip list from `useAssets()`, which falls back to
// empty when the backend is unreachable — making any chip-counting test
// flaky in CI. Instead we assert URL contract + control surface state,
// which are deterministic regardless of whether assets resolve.

test.describe("Compare", () => {
  test("empty state renders faint preview + CTA", async ({ page }) => {
    await page.goto("/compare");
    await page.waitForLoadState("networkidle").catch(() => {});

    await expect(
      page.getByText(/Pick a preset|begin|Empty state/i).first(),
    ).toBeVisible({ timeout: 8000 });
    await expect(
      page.getByRole("button", { name: /Major LSTs|Try/i }).first(),
    ).toBeVisible();
  });

  test("clicking CTA selects Major LSTs and updates URL", async ({ page }) => {
    await page.goto("/compare");
    await page.waitForLoadState("networkidle").catch(() => {});
    const cta = page.getByRole("button", { name: /Try .*Major LSTs/i }).first();
    await cta.click();
    await expect
      .poll(() => page.url(), { timeout: 8000 })
      .toMatch(/jitoSOL|mSOL|bSOL/);
  });

  test("URL `?s=...` is preserved across reload (deep-link contract)", async ({
    page,
  }) => {
    // Deep-link with two assets in the URL. The query must survive any
    // client-side rehydration — if useSearchParams/useRouter accidentally
    // dropped it on first paint, this test would catch it.
    await page.goto("/compare?s=jitoSOL%2CmSOL");
    await page.waitForLoadState("networkidle").catch(() => {});
    expect(page.url()).toMatch(/s=jitoSOL%2CmSOL|s=jitoSOL,mSOL/);

    // Reload — URL should still carry the same parameter.
    await page.reload();
    await page.waitForLoadState("networkidle").catch(() => {});
    expect(page.url()).toMatch(/s=jitoSOL%2CmSOL|s=jitoSOL,mSOL/);
  });

  test("Clear button strips the `s` param when selection is present", async ({
    page,
  }) => {
    // Land with a non-empty URL so the Clear button renders. We rely on
    // `?s=…` driving the Clear-button presence (it's gated on
    // selectedAssets.length > 0). Even if useAssets fails to resolve
    // (selectedAssets empty), the underlying `selected` array still has
    // entries and the page should let us reset.
    //
    // If Clear is never visible (selectedAssets fully gates it), skip
    // rather than fail — the URL contract is the primary thing this
    // suite asserts.
    await page.goto("/compare?s=jitoSOL%2CmSOL");
    await page.waitForLoadState("networkidle").catch(() => {});

    const clear = page.getByRole("button", { name: /^Clear$/ });
    if ((await clear.count()) === 0) {
      test.skip(
        true,
        "Clear button not rendered without resolved assets — skipping URL cleanup assertion",
      );
    }
    await clear.first().click();
    await expect
      .poll(() => new URL(page.url()).searchParams.has("s"), { timeout: 4000 })
      .toBe(false);
    expect(page.url()).not.toMatch(/s=/);
  });

  test("Save as watchlist writes the selected symbols to the REAL watchlist store", async ({
    page,
  }) => {
    // Regression: the button used to write a `pegana:watchlists` key that
    // NOTHING reads, faking a green "Saved" pill while discarding the work.
    // The real store the dashboard/peek read is `pegana.watchlist.v1`.
    // Deterministic without the backend — `selected` comes from the URL.
    await page.goto("/compare?s=jitoSOL%2CmSOL");
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.evaluate(() => localStorage.clear());

    const save = page.getByRole("button", {
      name: /Save as watchlist|Add to watchlist|Pin to watchlist/i,
    });
    await save.first().click();

    const stored = await page.evaluate(() =>
      localStorage.getItem("pegana.watchlist.v1"),
    );
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored as string)).toEqual(
      expect.arrayContaining(["jitoSOL", "mSOL"]),
    );
  });

  test("presets bar is stable when asset presets are available", async ({
    page,
  }) => {
    await page.goto("/compare");
    await page.waitForLoadState("networkidle").catch(() => {});

    const presets = page.getByText(/^Presets$/i);
    await expect(presets).toBeVisible({ timeout: 8000 });

    // Available preset buttons depend on resolved asset metadata; the page is
    // still valid when the API is unreachable, so do not fail the suite just
    // because live assets did not resolve in this run.
    const lstBtn = page.getByRole("button", { name: /^Major LSTs$/ });
    if ((await lstBtn.count()) === 0) {
      test.skip(true, "Preset buttons require resolved live assets");
    }
    await expect(lstBtn).toBeVisible({ timeout: 8000 });
  });
});
