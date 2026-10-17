import { expect, test } from "@playwright/test";

/**
 * Pagination is shared by four surfaces through one hook and one control, so a
 * regression here breaks the dashboard board, the /assets screener, /events and
 * the /lst directory at once. These run against /assets, which has enough rows
 * to page on any realistic dataset.
 */
test.describe("Pagination", () => {
  test.describe.configure({ mode: "serial" });

  test("paging animates, updates the URL, and announces itself", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __vtKinds: string[] };
      w.__vtKinds = [];
      const original = document.startViewTransition;
      if (typeof original !== "function") return;
      document.startViewTransition = function patched(
        this: Document,
        ...args: Parameters<Document["startViewTransition"]>
      ): ReturnType<Document["startViewTransition"]> {
        // Read the stamp at call time: the orchestrator sets it immediately
        // before, and clears it when the transition finishes.
        w.__vtKinds.push(document.documentElement.dataset.vt ?? "(none)");
        return original.apply(this, args);
      };
    });

    await page.goto("/assets", { waitUntil: "domcontentloaded" });

    const pager = page.getByRole("navigation", { name: "Screener pages" });
    await expect(pager).toBeVisible({ timeout: 30_000 });

    const status = pager.getByRole("status");
    const before = await status.textContent();
    expect(before).toMatch(/^Page 1 of \d+ · \d+ assets$/);

    await pager.getByRole("button", { name: "Next page" }).click();

    await expect(status).toHaveText(/^Page 2 of/, { timeout: 10_000 });
    // Shareable, survives a reload, and works with the back button.
    await expect(page).toHaveURL(/[?&]page=2/);

    const kinds = await page.evaluate(
      () => (window as unknown as { __vtKinds: string[] }).__vtKinds,
    );
    if (await page.evaluate(() => typeof document.startViewTransition === "function")) {
      expect(kinds).toContain("page-next");
    }

    // Going back is a different direction, and drops the parameter entirely
    // rather than leaving ?page=1 behind.
    await pager.getByRole("button", { name: "Previous page" }).click();
    await expect(status).toHaveText(/^Page 1 of/, { timeout: 10_000 });
    await expect(page).not.toHaveURL(/[?&]page=/);
  });

  test("a ?page= URL opens on that page", async ({ page }) => {
    await page.goto("/assets?page=2", { waitUntil: "domcontentloaded" });

    const pager = page.getByRole("navigation", { name: "Screener pages" });
    await expect(pager).toBeVisible({ timeout: 30_000 });
    await expect(pager.getByRole("status")).toHaveText(/^Page 2 of/, {
      timeout: 10_000,
    });
  });

  test("the controls are compact and clear of the table on a phone", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/assets", { waitUntil: "domcontentloaded" });

    const pager = page.getByRole("navigation", { name: "Screener pages" });
    await expect(pager).toBeVisible({ timeout: 30_000 });

    const m = await pager.evaluate((el) => {
      const prev = el.previousElementSibling;
      const nr = el.getBoundingClientRect();
      const pr = prev?.getBoundingClientRect();
      return {
        gapAbove: pr ? Math.round(nr.top - pr.bottom) : -1,
        buttons: Array.from(el.querySelectorAll("button")).map((b) => {
          const r = b.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height) };
        }),
        fits: nr.width <= window.innerWidth,
      };
    });

    // Flush against the table is what the founder reported: the dashboard was
    // overriding the shared spacing to mt-0/pt-0/border-t-0 and measured a 0px
    // gap. Spacing lives in the component now, so this holds everywhere.
    expect(m.gapAbove).toBeGreaterThanOrEqual(12);

    // Compact, per DESIGN.md §3 ("NEVER large/fat"), while staying well clear
    // of the WCAG 2.5.8 AA 24px floor. They were 82x44 around 10px text.
    expect(m.buttons).toHaveLength(2);
    for (const b of m.buttons) {
      expect(b.h).toBeGreaterThanOrEqual(24);
      expect(b.h).toBeLessThanOrEqual(42);
      expect(b.w).toBeLessThanOrEqual(96);
    }
    expect(m.fits).toBe(true);
    // Deliberately NOT asserting the pager is in the viewport: it sits below
    // 25 asset rows, so at scroll 0 it is legitimately off-screen. An earlier
    // version of this test checked that and failed on a perfectly correct page.
  });

  test("the ends of the range are disabled, not missing", async ({ page }) => {
    await page.goto("/assets", { waitUntil: "domcontentloaded" });

    const pager = page.getByRole("navigation", { name: "Screener pages" });
    await expect(pager).toBeVisible({ timeout: 30_000 });

    // aria-disabled alongside disabled, so the control stays discoverable to a
    // screen reader at the ends instead of vanishing from the tab order with
    // no explanation.
    const prev = pager.getByRole("button", { name: "Previous page" });
    await expect(prev).toBeDisabled();
    await expect(prev).toHaveAttribute("aria-disabled", "true");
  });
});
