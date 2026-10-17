import { test, expect } from "@playwright/test";

test.describe("Landing — primary flow (desktop 1440)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("renders the current landing landmarks", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    await expect(page.locator("h1").first()).toContainText(
      /Prove the peg of every asset you hold\./i,
    );
    await expect(
      page.getByRole("heading", {
        name: /Where the numbers come from\./i,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: /One signal, three ways to consume it\./i,
      }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", {
        name: /Don.t trust the score\. Replay it\./i,
      }),
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByRole("heading", {
        name: /See peg risk the way the people who carry it do\./i,
      }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("link", { name: /open the dashboard/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /assets api/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("REST API").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Product").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Methodology").first()).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Landing — mobile 390 (iPhone-ish)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("renders all primary landmarks at mobile width", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    await expect(page.locator("h1").first()).toContainText(
      /Prove the peg of every asset you hold\./i,
    );
    await expect(
      page.getByRole("heading", {
        name: /Where the numbers come from\./i,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: /One signal, three ways to consume it\./i,
      }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", {
        name: /Don.t trust the score\. Replay it\./i,
      }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", {
        name: /See peg risk the way the people who carry it do\./i,
      }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("page does not horizontal-scroll at mobile width", async ({ page }) => {
    await page.goto("/");
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);
  });
});

test.describe("Landing — GSAP animations actually run", () => {
  test("hero and sections settle into visible content", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("heading", {
        name: /Where the numbers come from\./i,
      }),
    ).toBeVisible();
  });

  test("hero reveal transitions the animated heading into its settled state", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const h1 = page.getByRole("heading", {
      level: 1,
      name: /Prove the peg of every asset you hold\./i,
    });
    // The hero h1 uses useRevealV2 (mode: "load", index: 0), which fires
    // after a 100ms timer. On a warm production cache the JS can hydrate
    // fast enough that the initial opacity:0 is already gone before we
    // can assert it. So we only assert the SETTLED state — the reveal
    // transition is 850ms, so by 2s it must be done.
    await expect(h1).toHaveCSS("opacity", "1", { timeout: 5_000 });
    await expect(h1).toHaveCSS("transform", "none", { timeout: 5_000 });
    await expect(h1).toHaveCSS("filter", /blur\(0px\)|none/, { timeout: 5_000 });
  });
});

test.describe("landing chrome — phone 390", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("no empty floating box paints a line at the bottom", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    // The MockDataBanner's wrapper used to render unconditionally while the
    // banner inside it returned null on every healthy load. An empty box with a
    // border and a background does not vanish: it collapsed to its own edges
    // and painted a 2px grey line pinned to the bottom of the viewport.
    const slivers = await page.evaluate(() => {
      const h = window.innerHeight;
      return Array.from(document.querySelectorAll("body *"))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          const painted =
            cs.backgroundColor !== "rgba(0, 0, 0, 0)" ||
            parseFloat(cs.borderTopWidth) > 0;
          return (
            r.height > 0 &&
            r.height <= 4 &&
            r.width > 200 &&
            r.bottom > h - 60 &&
            r.bottom <= h + 8 &&
            painted
          );
        })
        .map((el) => String(el.className).slice(0, 60));
    });

    expect(slivers).toEqual([]);
  });
});
