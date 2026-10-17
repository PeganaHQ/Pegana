import { expect, test, type Page } from "@playwright/test";

/**
 * Optical alignment of the mobile bars.
 *
 * The bug this pins: a 44px touch target wrapping a 16px glyph carries 14px of
 * dead space per side, and nothing compensated it. Every BOX measured correct —
 * the menu button's edge sat exactly 16px from the screen edge, same as the
 * logo — while the two visible marks sat 16px and 30px in. Measuring the boxes
 * is what let this ship; only the glyphs show what the eye sees.
 *
 * So these assertions deliberately measure the rendered svg/span geometry, not
 * the interactive element's bounding box.
 */

const SITE = process.env.PEGANA_APP_ORIGIN ?? "https://www.pegana.xyz";

type Glyph = { fromL: number; fromR: number; cy: number };

/** Union box of the visible marks inside the control matching `labelRe`. */
async function glyph(
  page: Page,
  barSel: string,
  labelRe: string,
): Promise<Glyph> {
  return page.evaluate(
    ([sel, re]) => {
      const vw = document.documentElement.clientWidth;
      const bar = document.querySelector(sel);
      if (!bar) throw new Error(`no bar for ${sel}`);
      const rx = new RegExp(re);
      for (const el of bar.querySelectorAll("a, button")) {
        const label = el.getAttribute("aria-label") ?? "";
        if (!rx.test(label)) continue;
        let l: number | null = null;
        let r: number | null = null;
        const centres: number[] = [];
        for (const c of el.querySelectorAll("svg, span")) {
          const b = c.getBoundingClientRect();
          if (!b.width || !b.height) continue;
          l = l === null ? b.left : Math.min(l, b.left);
          r = r === null ? b.right : Math.max(r, b.right);
          centres.push(b.y + b.height / 2);
        }
        if (l === null || r === null) continue;
        return {
          fromL: l,
          fromR: vw - r,
          cy: centres.reduce((a, b) => a + b, 0) / centres.length,
        };
      }
      throw new Error(`no control matching ${re}`);
    },
    [barSel, labelRe] as const,
  );
}

async function open(page: Page, path: string) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("pegana:onboarding_v1", "dismissed");
    } catch {
      /* private mode */
    }
  });
  await page.goto(`${SITE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4_000);
}

test.describe("mobile bar optical alignment", () => {
  test.beforeEach(async ({ page }) => {
    // The sheet trigger only exists below the app's lg breakpoint. On the
    // desktop project there is nothing to align, so this whole file is a no-op
    // rather than a false pass.
    const width = page.viewportSize()?.width ?? 0;
    test.skip(width >= 1024, "mobile-only chrome");
  });

  test("app topbar: logo and menu glyph are equidistant from their edges", async ({
    page,
  }) => {
    await open(page, "/dashboard");
    const logo = await glyph(page, "header.fixed", "^Pegana");
    const menu = await glyph(page, "header.fixed", "^Open menu$");

    // Was 16 vs 30 — the two sides of one bar, off by nearly 2x.
    expect(
      Math.abs(logo.fromL - menu.fromR),
      `logo sits ${logo.fromL.toFixed(1)}px from the left, menu glyph ${menu.fromR.toFixed(1)}px from the right`,
    ).toBeLessThanOrEqual(1);
  });

  test("app topbar: every mark shares one vertical centre", async ({
    page,
  }) => {
    await open(page, "/dashboard");
    const logo = await glyph(page, "header.fixed", "^Pegana");
    const menu = await glyph(page, "header.fixed", "^Open menu$");
    const search = await glyph(page, "header.fixed", "Search");

    // The brand mark rode a text baseline inside a blockified <a>, landing
    // 1.4px above the icons — roughly 4 physical pixels at 3x.
    for (const [name, other] of [
      ["menu", menu],
      ["search", search],
    ] as const) {
      expect(
        Math.abs(logo.cy - other.cy),
        `logo centre ${logo.cy.toFixed(2)} vs ${name} ${other.cy.toFixed(2)}`,
      ).toBeLessThanOrEqual(0.6);
    }
  });

  test("marketing pill: logo and menu glyph are equidistant from the pill", async ({
    page,
  }) => {
    await open(page, "/");
    const logo = await glyph(page, "nav.fixed", "^Pegana");
    const menu = await glyph(page, "nav.fixed", "^Open menu$");

    const pill = await page.evaluate(() => {
      const nav = document.querySelector("nav.fixed");
      if (!nav) throw new Error("no nav");
      let best: DOMRect | null = null;
      for (const el of nav.querySelectorAll("*")) {
        const b = el.getBoundingClientRect();
        if (parseFloat(getComputedStyle(el).borderRadius) < 20) continue;
        if (b.width < 200 || b.height < 30) continue;
        if (!best || b.width > best.width) best = b;
      }
      if (!best) throw new Error("no pill");
      return { left: best.left, right: best.right };
    });

    // Measured against the PILL's edges, not the viewport's — the pill is
    // inset from the screen, so viewport distances would compare two different
    // reference frames and always disagree.
    const vw = page.viewportSize()?.width ?? 390;
    const leftInset = logo.fromL - pill.left;
    const rightInset = pill.right - (vw - menu.fromR);

    expect(
      Math.abs(leftInset - rightInset),
      `logo ${leftInset.toFixed(1)}px inside the pill, menu glyph ${rightInset.toFixed(1)}px`,
    ).toBeLessThanOrEqual(1.5);
  });
});
