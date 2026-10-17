import { expect, test } from "@playwright/test";

/**
 * THE RULER THAT WAS MISSING.
 *
 * `mobile-shell.spec.ts` is the only suite that runs at 390x844, and every test
 * in it opens with
 *
 *     localStorage.setItem("pegana:onboarding_v1", "dismissed")
 *
 * (lines 60, 98, 176). So the first thing every new visitor sees has never been
 * rendered by Playwright at the viewport it breaks on. That is not an oversight
 * in one test — it is why the breakage shipped.
 *
 * The other half of the gap is what that suite asserts: page-level
 * `scrollWidth <= clientWidth`. That is blind to the two failure modes that
 * actually occur here — content overflowing *inside* an `overflow-x-auto`
 * ancestor, and a flex/grid child squeezed below usability. Neither moves the
 * document's scroll width, so a broken page passes.
 *
 * So this file asserts something different and stricter: **no descendant of the
 * dialog may render outside the dialog's own box**, walked across all five
 * steps, at three widths.
 *
 * 768 is not decorative. Measured against production: step 1 is clean at 768
 * while step 2 overflows its container by 39px there, with the numbers at 54px
 * (`sm:text-[54px]`). A fix aimed only at `<640px` would leave iPad portrait and
 * half-width laptop windows broken, and no existing test would notice.
 */

const STORAGE_KEY = "pegana:onboarding_v1";

/** Widths that matter: phone, the sidebar-activation band, and desktop. */
const VIEWPORTS = [
  { name: "phone 390", width: 390, height: 844 },
  { name: "tablet 768", width: 768, height: 1024 },
  { name: "desktop 1280", width: 1280, height: 900 },
] as const;

const STEP_COUNT = 5;

/** Open /dashboard with onboarding NOT suppressed — the opposite of mobile-shell. */
async function openOnboarding(page: import("@playwright/test").Page) {
  await page.addInitScript((key) => {
    window.localStorage.removeItem(key);
  }, STORAGE_KEY);
  await page.goto("/dashboard");
  // Anchor on the step tablist, NOT on text. Filtering by `hasText: /Pegana/`
  // silently stops matching once a step's copy no longer contains the word, and
  // the locator then resolves to nothing mid-walk — which is what made this
  // suite "fail" at 1280 on a layout that is actually clean at every step.
  const dialog = page
    .getByRole("dialog")
    .filter({ has: page.locator('[aria-label="Onboarding steps"]') })
    .first();
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await settle(page);
  return dialog;
}

/**
 * Wait for web fonts before measuring anything.
 *
 * Without this the suite reports overflow that does not exist: text laid out in
 * the fallback face is wider than the loaded face, so a first measurement can
 * fail on a layout that is actually fine. Caught by walking the same five steps
 * by hand at 1280 — all clean — while the spec called it broken. A ruler that
 * cries wolf gets ignored, which is exactly how the original bug survived.
 */
async function settle(page: import("@playwright/test").Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(400);
}

/**
 * Every element whose painted box escapes the dialog's box.
 *
 * Ignores zero-size nodes, `aria-hidden` decoration, and the sr-only pattern
 * (`clip: inset(50%)` at 1x1) — that one is a deliberate screen-reader
 * announcement, not a layout bug, and flagging it would train people to ignore
 * this test.
 */
async function escapingChildren(dialog: import("@playwright/test").Locator) {
  return dialog.evaluate((root) => {
    const box = root.getBoundingClientRect();
    const out: Array<{
      tag: string;
      text: string;
      className: string;
      overflowRight: number;
      overflowLeft: number;
      overflowTop: number;
    }> = [];
    for (const el of Array.from(root.querySelectorAll("*"))) {
      const b = el.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      const cs = getComputedStyle(el);
      if (cs.position === "absolute" && cs.clipPath?.includes("inset(50%)")) continue;
      const right = Math.round(b.right - box.right);
      const left = Math.round(box.left - b.left);
      const top = Math.round(box.top - b.top);
      if (right <= 1 && left <= 1 && top <= 1) continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || "").trim().slice(0, 40),
        className: String((el as HTMLElement).className || "").slice(0, 70),
        overflowRight: right,
        overflowLeft: left,
        overflowTop: top,
      });
    }
    return out;
  });
}

for (const vp of VIEWPORTS) {
  test.describe(`onboarding modal — ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("no step renders content outside the dialog box", async ({ page }) => {
      const dialog = await openOnboarding(page);
      const failures: string[] = [];

      for (let step = 1; step <= STEP_COUNT; step++) {
        // Let the step transition AND any newly-revealed font/layout settle.
        await page.waitForTimeout(600);
        await settle(page);
        const heading = (await dialog.getByRole("heading", { level: 2 }).first().textContent()) ?? "";
        const escapes = await escapingChildren(dialog);

        if (escapes.length > 0) {
          const worst = escapes
            .sort(
              (a, b) =>
                Math.max(b.overflowRight, b.overflowLeft, b.overflowTop) -
                Math.max(a.overflowRight, a.overflowLeft, a.overflowTop),
            )
            .slice(0, 4)
            .map(
              (e) =>
                `      <${e.tag}> "${e.text}" [${e.className}] ` +
                `right+${e.overflowRight} left+${e.overflowLeft} top+${e.overflowTop}`,
            )
            .join("\n");
          failures.push(
            `  step ${step} ("${heading.trim()}") — ${escapes.length} element(s) outside the dialog:\n${worst}`,
          );
        }

        if (step < STEP_COUNT) {
          const next = dialog.getByRole("button", { name: /^next$/i });
          if (!(await next.isVisible().catch(() => false))) break;
          await next.click();
        }
      }

      expect(
        failures,
        `Content escaped the dialog at ${vp.width}px:\n${failures.join("\n")}`,
      ).toEqual([]);
    });

    test("the step heading never collides with the step navigation", async ({ page }) => {
      // The mobile step-nav row and the heading are in different containers, so
      // nothing stops them overlapping once the centered content column
      // overflows upward. Measured on production at 390: 25px of collision.
      const dialog = await openOnboarding(page);
      const overlap = await dialog.evaluate((root) => {
        // Anchor on the ARIA label, not a layout class. This located the nav by
        // `className.includes("overflow-x-auto")` — and the very commit that
        // fixed the nav replaced that class with `flex flex-wrap`, so the
        // locator silently matched nothing, the guard returned 0, and
        // `expect(0).toBe(0)` passed at every viewport. The test could no
        // longer fail on the regression it exists for. Exactly the "ruler that
        // cries wolf" this file's header warns about, inverted.
        const h2 = root.querySelector("h2");
        if (!h2) return 0;
        const b = h2.getBoundingClientRect();

        // Two elements carry this label: the desktop sidebar nav and the
        // mobile pill row. Check BOTH, and require overlap on BOTH axes —
        // a Y-only test reports the desktop sidebar (left of the heading,
        // same vertical band) as a collision when nothing overlaps at all.
        let worst = 0;
        for (const nav of root.querySelectorAll('[aria-label="Onboarding steps"]')) {
          const a = nav.getBoundingClientRect();
          if (a.width < 1 || a.height < 1) continue;
          const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          if (y > 0 && x > 0) worst = Math.max(worst, Math.round(Math.min(x, y)));
        }
        return worst;
      });
      expect(overlap, `heading overlaps the step nav by ${overlap}px`).toBe(0);
    });

    test("every step is reachable without horizontal scrolling the nav", async ({ page }) => {
      // At 390 the pill row needs 516px in a 340px box, so steps 4 and 5
      // ("Surface", "Action") sit entirely off-screen with no scroll affordance.
      const dialog = await openOnboarding(page);
      const offscreen = await dialog.evaluate((root) => {
        const vw = window.innerWidth;
        return Array.from(root.querySelectorAll('[role="tab"], button'))
          .filter((el) => {
            const b = el.getBoundingClientRect();
            return b.width > 0 && (b.right > vw + 1 || b.left < -1);
          })
          .map((el) => (el.textContent || "").trim().slice(0, 24));
      });
      expect(
        offscreen,
        `step controls rendered outside the viewport: ${offscreen.join(", ")}`,
      ).toEqual([]);
    });
  });
}

test.describe("onboarding dismissal semantics", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Escape closes for this visit but does NOT permanently dismiss", async ({ page }) => {
    // `<Dialog onOpenChange={(next) => !next && dismiss()}>` routes Escape and
    // outside-tap through the permanent localStorage write. On a phone the card
    // leaves real backdrop margin on every side, so one mis-tap destroys the
    // only walkthrough — and `reopenOnboarding()` has zero callers anywhere in
    // the app, so there is no way back short of clearing site storage.
    const dialog = await openOnboarding(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    const stored = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      STORAGE_KEY,
    );
    expect(
      stored,
      "Escape must not write the permanent dismissal flag; that is what Skip is for",
    ).not.toBe("dismissed");
  });

  test("the explicit close control DOES permanently dismiss", async ({ page }) => {
    // "Skip onboarding" lives in the sidebar, which is `hidden md:flex` — so on
    // a phone it does not exist and the X is the only deliberate control. Assert
    // the deliberate path per viewport rather than assuming Skip is reachable.
    const dialog = await openOnboarding(page);
    await dialog.getByRole("button", { name: /close onboarding/i }).first().click();
    await expect(dialog).toBeHidden();
    const stored = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      STORAGE_KEY,
    );
    expect(stored).toBe("dismissed");
  });
});
