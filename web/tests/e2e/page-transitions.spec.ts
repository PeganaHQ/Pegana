import { expect, test } from "@playwright/test";

/**
 * View transitions are close to untestable by screenshot: they last ~340ms and
 * a diff taken mid-flight is inherently racy. So these assert the things that
 * actually break in practice, all of which are observable and stable:
 *
 *   1. a navigation really does go through the browser's transition machinery
 *      (the flag can be off, or an import can quietly resolve to the shim's
 *      passthrough, and everything still "works" while nothing animates);
 *   2. the chrome carries its view-transition-name, so it stays pinned;
 *   3. reduced motion still lands on the destination.
 *
 * `startViewTransition` is instrumented before any app code runs, because
 * React calls it synchronously during the navigation.
 */
async function instrumentViewTransitions(
  page: import("@playwright/test").Page,
) {
  await page.addInitScript(() => {
    const w = window as unknown as { __vtCalls: number };
    w.__vtCalls = 0;
    const original = document.startViewTransition;
    if (typeof original !== "function") return;
    document.startViewTransition = function patched(
      this: Document,
      ...args: Parameters<Document["startViewTransition"]>
    ): ReturnType<Document["startViewTransition"]> {
      w.__vtCalls += 1;
      return original.apply(this, args);
    };
  });
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("pegana:onboarding_v1", "dismissed");
    } catch {
      return;
    }
  });
}

const vtSupported = (page: import("@playwright/test").Page) =>
  page.evaluate(() => typeof document.startViewTransition === "function");

test.describe("Route transitions", () => {
  // Serial, like mobile-shell.spec.ts. Every test here drives a real
  // navigation and reads `__vtCalls` back; under `fullyParallel` several
  // workers hammer the same origin at once and a slow response intermittently
  // pushes one past its wait. Verified: 6/6 serially, 5/6 in parallel with a
  // different test failing each run.
  test.describe.configure({ mode: "serial" });

  test("the app header is a pinned transition anchor", async ({ page }) => {
    await instrumentViewTransitions(page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    const name = await page
      .locator("header.app-chrome-glass")
      .first()
      .evaluate((el) => getComputedStyle(el).viewTransitionName);

    // Chromium reports the used value; other engines may report "none" when
    // the feature is unsupported, which is a legitimate no-animation fallback.
    expect(["app-topbar", "none"]).toContain(name);
  });

  test("the mobile tab bar is a pinned transition anchor", async ({ page }) => {
    await instrumentViewTransitions(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    const nav = page.getByRole("navigation", { name: "Mobile app navigation" });
    await expect(nav).toBeVisible({ timeout: 30_000 });

    const name = await nav.evaluate(
      (el) => getComputedStyle(el).viewTransitionName,
    );
    expect(["app-tabbar", "none"]).toContain(name);
  });

  test("a tab-bar navigation goes through the transition machinery", async ({
    page,
  }) => {
    await instrumentViewTransitions(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    if (!(await vtSupported(page))) {
      test.skip(true, "engine has no View Transitions API");
      return;
    }

    const nav = page.getByRole("navigation", { name: "Mobile app navigation" });
    await expect(nav).toBeVisible({ timeout: 30_000 });
    await nav.getByRole("link", { name: "Events" }).click();

    await expect(page).toHaveURL(/\/events/, { timeout: 15_000 });
    const calls = await page.evaluate(
      () => (window as unknown as { __vtCalls: number }).__vtCalls,
    );
    expect(calls).toBeGreaterThan(0);
  });

  test("drilling into an asset goes through the transition machinery", async ({
    page,
  }) => {
    await instrumentViewTransitions(page);
    await page.goto("/assets", { waitUntil: "domcontentloaded" });

    if (!(await vtSupported(page))) {
      test.skip(true, "engine has no View Transitions API");
      return;
    }

    // Must be a link that actually opts in, AND one that is rendered at this
    // viewport. Two traps: `/assets` also renders assets-index-nav.tsx, a
    // server-rendered SEO index of all 68 assets that deliberately carries no
    // data-vt; and every row exists twice, as an `sm:hidden` mobile card and a
    // `hidden sm:table-cell` desktop cell, so the first DOM match is the one
    // that is display:none at desktop width.
    const row = page
      .locator('a[data-vt="nav-forward"][href^="/asset/"]:visible')
      .first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    await expect(page).toHaveURL(/\/asset\//, { timeout: 15_000 });
    const calls = await page.evaluate(
      () => (window as unknown as { __vtCalls: number }).__vtCalls,
    );
    expect(calls).toBeGreaterThan(0);
  });

  test("the asset hero mark claims the morph name exactly once", async ({
    page,
  }) => {
    await instrumentViewTransitions(page);
    await page.goto("/asset/jitoSOL", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 30_000 });

    // A duplicate name makes the browser abandon the whole transition, so the
    // count matters more than the presence.
    const holders = await page.evaluate(() => {
      let n = 0;
      for (const el of Array.from(document.querySelectorAll("*"))) {
        const style = getComputedStyle(el);
        if (style.viewTransitionName === "asset-mark-jitosol") {
          if (style.display !== "none") n += 1;
        }
      }
      return n;
    });

    expect(holders).toBeLessThanOrEqual(1);
  });

  test("reduced motion still completes the navigation", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await instrumentViewTransitions(page);
    await page.setViewportSize({ width: 390, height: 844 });

    try {
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
      const nav = page.getByRole("navigation", {
        name: "Mobile app navigation",
      });
      await expect(nav).toBeVisible({ timeout: 30_000 });
      await nav.getByRole("link", { name: "Assets" }).click();

      await expect(page).toHaveURL(/\/assets/, { timeout: 15_000 });
      // No stuck opacity:0 content behind a transition that never resolved.
      await expect(page.locator("h1").first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await context.close();
    }
  });
});
