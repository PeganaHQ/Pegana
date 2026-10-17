import { test, expect } from "@playwright/test";

// Dashboard rebuild — table-first (tokens.xyz DNA, 2026-07-14): the board is
// the whole default view (toolbar + a real paginated <table>). The verdict-
// hero + universe strip that used to sit on top of every visit (the original
// Command Center single-column shell — see
// docs/design-research/2026-07-11-app-reimagination-MASTER.md for that
// rationale, and for why the 3-pane sidebar/list/peek-pane shell it replaced
// is gone: founder rejected the peek pane, no hover-preview affordance
// survives on the board itself either, every row is a plain click-through
// Link) now live behind a compact "System status" trigger button, revealed
// on HOVER (desktop) / FOCUS (keyboard/tap) as a HoverCard — not a click
// dialog (2026-07-14 founder feedback: the click-modal read as square/heavy
// for a glance-only surface).

const ONBOARDING_STORAGE_KEY = "pegana:onboarding_v1";

async function waitForDashboardToSettle(
  page: import("@playwright/test").Page,
) {
  await expect(
    page
      .getByRole("table", { name: "Tracked assets" })
      .or(page.getByText(/Live feed unreachable/i))
      .or(page.getByText(/No assets match this filter\./i)),
  ).toBeVisible({ timeout: 15_000 });
}

async function dismissDashboardOnboarding(
  page: import("@playwright/test").Page,
) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [ONBOARDING_STORAGE_KEY, "dismissed"],
  );
}

test.describe("Dashboard — desktop 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("renders the app nav + board, and the System status hover-card carries the verdict", async ({
    page,
  }) => {
    await dismissDashboardOnboarding(page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    await expect(page.getByLabel("Pegana, dashboard home")).toBeVisible();
    const nav = page.getByRole("navigation", { name: "App navigation" });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // Assets is a first-class nav item now; Account moved out of the primary
    // nav into the account avatar/menu on the right.
    await expect(nav.getByRole("link", { name: "Assets" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Events" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Compare" })).toBeVisible();

    // System status now lives behind a compact trigger (flat state dot +
    // worst-first label, e.g. "2 drifting" / "All holding") in the board's
    // toolbar — no longer a strip pinned to the top of the page (table-first
    // rebuild, 2026-07-14).
    const statusButton = page.getByRole("button", {
      name: /^System status:/i,
    });
    await expect(statusButton).toBeVisible();

    await expect(
      page.getByLabel("Filter assets by symbol, name, or class").first(),
    ).toBeVisible();

    // `[data-asset]:visible`, never a bare `[data-asset]`. Every board row renders
    // TWICE — an `sm:hidden` mobile card and a `hidden sm:table-cell` desktop cell —
    // and both carry the attribute, because it names the row's asset and it was
    // incoherent for only one variant to have it. So a bare selector matches two
    // nodes per row, one of which is display:none at any given width, and
    // `.first()`/`.nth(0)` picks whichever happens to come first in DOM order: the
    // mobile card, which is invisible at desktop. `:visible` makes these assertions
    // mean "the row the user can actually see", at any viewport.
    const rows = page.locator("[data-asset]:visible");
    await waitForDashboardToSettle(page);

    const rowCount = await rows.count();
    if (rowCount > 0) {
      expect(rowCount).toBeGreaterThan(1);
      // Verdict headline moved into the System status hover-card (not a
      // click dialog, 2026-07-14) — hover the trigger to reveal it, then
      // assert one of the always-complete worst-first sentences (never an
      // empty/negative placeholder on a calm day) directly on the page.
      await statusButton.hover();
      await expect(page.getByText(/tracked/i).first()).toBeVisible();
      await expect(
        page.getByText(/off peg right now\.|drifting\.|holding peg\./i).first(),
      ).toBeVisible();
    } else {
      // A genuinely empty tracked universe: the same "0 tracked" fact now
      // surfaces inside the hover-card rather than on the page body.
      await statusButton.hover();
      await expect(page.getByText(/0 tracked/i)).toBeVisible();
    }
  });

  test("clicking a board row navigates straight to the asset page (no peek pane)", async ({
    page,
  }) => {
    await dismissDashboardOnboarding(page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    const rows = page.locator("[data-asset]:visible");
    await waitForDashboardToSettle(page);
    const rowCount = await rows.count();
    test.skip(
      rowCount === 0,
      "dashboard is in fallback mode; no live rows to click",
    );

    const symbol = await rows.nth(0).getAttribute("data-asset");
    expect(symbol).toBeTruthy();
    await rows.nth(0).click();
    await expect(page).toHaveURL(
      new RegExp(`/asset/${encodeURIComponent(symbol!)}$`),
    );

    // The 3-pane peek affordance is gone from this surface entirely.
    await expect(
      page.locator('[data-testid="asset-preview-pane"]'),
    ).toHaveCount(0);
  });

  test("class pill narrows the board", async ({ page }) => {
    await dismissDashboardOnboarding(page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    const allRows = page.locator("[data-asset]:visible");
    await waitForDashboardToSettle(page);
    const allCount = await allRows.count();
    test.skip(
      allCount === 0,
      "dashboard is in fallback mode; no live rows to filter",
    );

    const lstFilter = page.getByRole("button", { name: /^LSTs\s+\d+$/i });
    if ((await lstFilter.count()) > 0) {
      await lstFilter.click();
      await expect(lstFilter).toHaveAttribute("aria-pressed", "true");
      const lstCount = await allRows.count();
      // After filtering to LSTs we should see fewer (or equal) rows.
      expect(lstCount).toBeLessThanOrEqual(allCount);
    }
  });
});

test.describe("Dashboard — mobile 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("brand mark renders at mobile width (same single-column spine, stacked)", async ({
    page,
  }) => {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    // BrandMark uses aria-label="Pegana"
    await expect(
      page.getByLabel("Pegana", { exact: false }).first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test("no horizontal scroll at mobile width", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);
  });

  test("no peek pane exists at mobile width (surface was removed dashboard-wide)", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.waitForTimeout(500);
    await expect(
      page.locator('[data-testid="asset-preview-pane"]'),
    ).toHaveCount(0);
  });
});
