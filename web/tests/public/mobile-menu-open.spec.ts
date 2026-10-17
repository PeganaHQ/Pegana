import { expect, test, type Page } from "@playwright/test";

/**
 * The OPEN mobile menu.
 *
 * Every guard in this repo measured the CLOSED bar. A whole session of work
 * reported green while the menu the founder was actually looking at had five
 * visible defects: the close button landed 14px left and 10px below the
 * hamburger it replaces, a global focus rule painted a white ring on the
 * trigger and a white seam across the panel's top edge, three controls sat
 * under the 44px touch floor, and a four-item marketing menu painted 165px of
 * dead black under its own CTAs.
 *
 * None of that is reachable without opening the menu, so every assertion here
 * opens it first. The numbers in the comments are the measured pre-fix values.
 */

const SITE = process.env.PEGANA_APP_ORIGIN ?? "https://www.pegana.xyz";

const SURFACES = [
  { name: "marketing", path: "/", bar: "nav.fixed" },
  { name: "app", path: "/dashboard", bar: "header.fixed" },
] as const;

/** Rendered glyph geometry — the svg/span rects, never the touch target. */
async function glyphOf(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`missing ${sel}`);
    let right: number | null = null;
    const centres: number[] = [];
    for (const child of el.querySelectorAll("svg, span")) {
      const b = child.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      right = right === null ? b.right : Math.max(right, b.right);
      centres.push(b.y + b.height / 2);
    }
    if (right === null) throw new Error(`no rendered glyph inside ${sel}`);
    return {
      fromRight: window.innerWidth - right,
      cy: centres.reduce((a, b) => a + b, 0) / centres.length,
    };
  }, selector);
}

async function openMenu(page: Page, path: string) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("pegana:onboarding_v1", "dismissed");
    } catch {
      /* private mode */
    }
  });
  await page.goto(`${SITE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5_000);

  const trigger = 'button[aria-label="Open menu"]';
  await expect(page.locator(trigger)).toBeVisible();
  const before = await glyphOf(page, trigger);

  // A real touch, not a synthetic click: the focus-ring defect only appeared
  // on pointer input, because a native <dialog> hands focus back to its invoker
  // on close and WebKit treats that programmatic restore as :focus-visible.
  await page.tap(trigger);
  await page.waitForTimeout(1_200);

  // Guard against a vacuous pass: if the sheet never opened, everything below
  // would measure nothing and agree with itself.
  await expect(page.locator("dialog")).toBeVisible();
  return before;
}

test.describe("open mobile menu", () => {
  test.beforeEach(async ({ page }) => {
    const width = page.viewportSize()?.width ?? 0;
    test.skip(width >= 1024, "the sheet only exists below lg");
  });

  for (const surface of SURFACES) {
    test(`${surface.name}: the X lands exactly where the hamburger was`, async ({
      page,
    }) => {
      // Pre-fix: the close button was `fixed right-5 top-4` on both surfaces,
      // so it knew nothing about the bar above it. dx +14 / dy +10.5 on the app
      // bar, dx -31 / dy -11 on the marketing pill.
      const before = await openMenu(page, surface.path);
      const after = await glyphOf(
        page,
        'dialog button[aria-label="Close menu"]',
      );

      expect(
        Math.abs(after.fromRight - before.fromRight),
        `glyph moved ${(after.fromRight - before.fromRight).toFixed(1)}px horizontally on open`,
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(after.cy - before.cy),
        `glyph moved ${(after.cy - before.cy).toFixed(1)}px vertically on open`,
      ).toBeLessThanOrEqual(1);
    });

    test(`${surface.name}: the dialog paints no focus outline`, async ({
      page,
    }) => {
      // showModal() focuses the dialog, and globals.css's unlayered
      // `*:focus-visible` rule drew `2px solid #f5f5f6` around a box spanning
      // the whole sheet. Only its top edge was on screen: a hard white seam.
      await openMenu(page, surface.path);
      const outline = await page.evaluate(() => {
        const d = document.querySelector("dialog");
        if (!d) throw new Error("no dialog");
        return getComputedStyle(d).outline;
      });
      expect(outline).not.toMatch(/\bsolid\b/);
    });

    test(`${surface.name}: every control in the sheet clears 44px`, async ({
      page,
    }) => {
      await openMenu(page, surface.path);
      const small = await page.evaluate(() => {
        const d = document.querySelector("dialog");
        if (!d) throw new Error("no dialog");
        return [...d.querySelectorAll("a, button")]
          .map((el) => ({
            label: (
              el.getAttribute("aria-label") ||
              el.textContent?.trim() ||
              "?"
            ).slice(0, 24),
            h: el.getBoundingClientRect().height,
            w: el.getBoundingClientRect().width,
          }))
          .filter((c) => c.w > 0 && c.h > 0 && c.h < 44);
      });
      // Pre-fix: "Do not show again" at 15px, and both marketing CTAs at 36px.
      expect(small, `controls under the 44px floor: ${JSON.stringify(small)}`)
        .toEqual([]);
    });

    test(`${surface.name}: dismissing by touch leaves no focus ring`, async ({
      page,
    }) => {
      await openMenu(page, surface.path);
      await page.tap('dialog button[aria-label="Close menu"]');
      await page.waitForTimeout(900);

      const trigger = await page.evaluate(() => {
        const t = document.querySelector('button[aria-label="Open menu"]');
        if (!t) throw new Error("no trigger");
        return {
          focused: document.activeElement === t,
          outline: getComputedStyle(t).outline,
        };
      });
      // The white square the founder kept reporting was here — on the TRIGGER,
      // after closing, not on the X.
      expect(trigger.outline).not.toMatch(/\bsolid\b/);
      expect(trigger.focused).toBe(false);
    });

    test(`${surface.name}: the open sheet causes no horizontal overflow`, async ({
      page,
    }) => {
      await openMenu(page, surface.path);
      const { scrollW, clientW } = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      expect(scrollW).toBe(clientW);
    });
  }

  test("marketing: the panel hugs its content instead of filling the screen", async ({
    page,
  }) => {
    // A four-item menu painted the full band: 592px of opaque panel for 427px
    // of content, so 165px (27.8%) was dead black below the CTAs. In flow, the
    // uncovered part of the dialog also restores tap-outside-to-dismiss, which
    // could never fire while the panel covered every pixel.
    await openMenu(page, "/");
    const { panelH, dialogH } = await page.evaluate(() => {
      const panel = document.querySelector("[data-mobile-menu-panel]");
      const dialog = document.querySelector("dialog");
      if (!panel || !dialog) throw new Error("missing panel or dialog");
      return {
        panelH: panel.getBoundingClientRect().height,
        dialogH: dialog.getBoundingClientRect().height,
      };
    });
    expect(panelH).toBeGreaterThan(0);
    expect(
      panelH,
      `panel ${panelH.toFixed(0)}px fills the ${dialogH.toFixed(0)}px band`,
    ).toBeLessThan(dialogH - 40);
  });
});
