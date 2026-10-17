import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const APP_ROUTES = [
  { path: "/dashboard", tab: "Dashboard", landmark: /System status:/i },
  { path: "/assets", tab: "Assets", landmark: /Assets|Tracked/i },
  { path: "/events", tab: "Events", landmark: /Events|Heatmap/i },
  {
    path: "/compare",
    tab: null,
    landmark: /Stack assets|Spot drifts|Compare/i,
  },
] as const;

async function expectNoPageHorizontalScroll(
  page: import("@playwright/test").Page,
) {
  await page.evaluate(() => window.scrollTo(9_999, window.scrollY));
  const overflow = await page.evaluate(() => ({
    scrollX: window.scrollX,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);
  expect(overflow.scrollX).toBe(0);
}

async function expectNoBlockingA11y(
  page: import("@playwright/test").Page,
  selector: string,
) {
  const results = await new AxeBuilder({ page })
    .include(selector)
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations.filter((v) => v.id !== "color-contrast")).toEqual(
    [],
  );
}

test.describe("Mobile shell — 390", () => {
  test.describe.configure({ mode: "serial" });
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  for (const route of APP_ROUTES) {
    test(`${route.path} renders with bottom nav and no page overflow`, async ({
      page,
    }) => {
      await page.addInitScript(() => {
        try {
          window.localStorage.setItem("pegana:onboarding_v1", "dismissed");
        } catch {
          return;
        }
      });
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      if (route.path === "/dashboard") {
        await expect(
          page.getByRole("button", { name: /^System status:/i }),
        ).toBeVisible({ timeout: 30_000 });
      } else {
        await expect(page.locator("body")).toContainText(route.landmark, {
          timeout: 15_000,
        });
      }

      const nav = page.getByRole("navigation", {
        name: "Mobile app navigation",
      });
      await expect(nav).toBeVisible();
      if (route.tab) {
        await expect(
          nav.getByRole("link", { name: route.tab }),
        ).toHaveAttribute("aria-current", "page");
      }
      await expectNoBlockingA11y(
        page,
        'nav[aria-label="Mobile app navigation"]',
      );
      await expectNoPageHorizontalScroll(page);
    });
  }

  test("hamburger opens as a modal dialog and the visible X closes it", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("pegana:onboarding_v1", "dismissed");
      } catch {
        return;
      }
    });
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    const trigger = page.locator('button[aria-controls="mobile-menu-dialog"]');
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.tap();

    const dialog = page.locator("#mobile-menu-dialog");
    await expect(dialog).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(dialog.getByRole("link", { name: "Compare" })).toBeVisible();
    await expectNoBlockingA11y(page, "#mobile-menu-dialog");

    await page.getByRole("button", { name: "Close menu" }).last().tap();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Open menu" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  test("hamburger stays viewport-fixed on scroll and exposes one visible close control", async ({
    page,
  }) => {
    await page.goto("/events", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText(/Events|Heatmap/i, {
      timeout: 15_000,
    });
    await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.setAttribute("data-e2e-scroll-spacer", "true");
      spacer.style.height = "1200px";
      document.body.appendChild(spacer);
    });

    await page.evaluate(() => window.scrollTo(0, 700));
    await page.waitForTimeout(150);

    const trigger = page.locator('button[aria-controls="mobile-menu-dialog"]');
    await expect(trigger).toBeVisible();
    const triggerBox = await trigger.boundingBox();
    expect(triggerBox?.y ?? 999).toBeLessThan(40);

    await trigger.tap();
    const dialog = page.locator("#mobile-menu-dialog");
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(400);
    const openTriggerBox = await trigger.boundingBox();
    expect(openTriggerBox?.y ?? 999).toBeLessThan(40);

    const visibleCloseButtons = await page
      .getByRole("button", { name: "Close menu" })
      .evaluateAll(
        (buttons) =>
          buttons.filter((button) => {
            const rect = button.getBoundingClientRect();
            const style = window.getComputedStyle(button);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.visibility !== "hidden" &&
              style.display !== "none" &&
              Number(style.opacity) > 0.01
            );
          }).length,
      );
    expect(visibleCloseButtons).toBe(1);

    await expectNoPageHorizontalScroll(page);
  });

  test("dashboard class filters remain operable on mobile", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("pegana:onboarding_v1", "dismissed");
      } catch {
        return;
      }
    });
    await page.goto("/dashboard", { waitUntil: "networkidle" });

    const filters = page.getByRole("group", {
      name: "Dashboard asset class filter",
    });
    await expect(filters).toBeVisible({ timeout: 30_000 });
    const lstFilter = filters.getByRole("button", { name: /^LSTs/ });
    await lstFilter.tap();
    await expect(lstFilter).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
    await expectNoBlockingA11y(
      page,
      '[role="group"][aria-label="Dashboard asset class filter"]',
    );
  });

  test("the sheet complements the tab bar instead of repeating it", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("pegana:onboarding_v1", "dismissed");
      } catch {
        return;
      }
    });
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    const nav = page.getByRole("navigation", { name: "Mobile app navigation" });
    await expect(nav).toBeVisible({ timeout: 30_000 });

    await page.locator('button[aria-controls="mobile-menu-dialog"]').tap();
    const dialog = page.locator("#mobile-menu-dialog");
    await expect(dialog).toBeVisible();

    // The four tab-bar destinations must NOT reappear as sheet rows. This was
    // the actual defect: the sheet's first four entries were Dashboard /
    // Assets / Events / Account, i.e. the four tabs already pinned to the
    // bottom of the same screen.
    for (const tab of ["Dashboard", "Assets", "Events"]) {
      await expect(
        dialog.getByRole("link", { name: tab, exact: true }),
      ).toHaveCount(0);
    }

    // What it DOES carry: the destinations with no other entry point.
    for (const item of ["Compare", "Risk heatmap", "LST directory", "Status"]) {
      await expect(
        dialog.getByRole("link", { name: item, exact: true }),
      ).toBeVisible();
    }

    // Grouped, not a flat index.
    await expect(dialog.getByText("Analyze", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Trust", { exact: true })).toBeVisible();

    await expectNoBlockingA11y(page, "#mobile-menu-dialog");
  });

  test("the header is one row and does not duplicate the Account tab", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("pegana:onboarding_v1", "dismissed");
      } catch {
        return;
      }
    });
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    const header = page.locator("header.app-chrome-glass").first();
    await expect(header).toBeVisible({ timeout: 30_000 });

    // --app-topbar-h is the single source of truth for every offset in the
    // shell; if the header's real height drifts from it, content slides under
    // the chrome on every route at once.
    const { headerH, tokenH } = await header.evaluate((el) => ({
      headerH: Math.round(el.getBoundingClientRect().height),
      tokenH: getComputedStyle(document.documentElement).getPropertyValue(
        "--app-topbar-h",
      ),
    }));
    expect(headerH).toBe(Number.parseInt(tokenH, 10));

    // Identity lives in the Account tab and the sheet's "You" group on a
    // phone. A third copy in the header was the fourth nav affordance in
    // 390px.
    await expect(header.getByRole("link", { name: /sign in/i })).toHaveCount(0);
  });

  test("the highlight cards page sideways instead of stacking two screens tall", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("pegana:onboarding_v1", "dismissed");
      } catch {
        return;
      }
    });
    await page.goto("/dashboard", { waitUntil: "networkidle" });

    const highlights = page.getByRole("region", { name: "Highlights" });
    await expect(highlights).toBeVisible({ timeout: 30_000 });

    const metrics = await highlights.evaluate((el) => ({
      scrolls: el.scrollWidth > el.clientWidth + 4,
      height: Math.round(el.getBoundingClientRect().height),
    }));

    // Scrolls inside itself, and does not cost a second full screen.
    expect(metrics.scrolls).toBe(true);
    expect(metrics.height).toBeLessThan(520);

    // And the page body still must not scroll sideways.
    await expectNoPageHorizontalScroll(page);
  });

  test("the tab bar floats, and its styles actually paint", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("pegana:onboarding_v1", "dismissed");
      } catch {
        return;
      }
    });
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    const nav = page.getByRole("navigation", { name: "Mobile app navigation" });
    await expect(nav).toBeVisible({ timeout: 30_000 });

    const m = await nav.evaluate((el) => {
      const pill = el.querySelector(".app-tabbar-pill") as HTMLElement | null;
      const links = Array.from(el.querySelectorAll("a"));
      const pr = pill?.getBoundingClientRect();
      return {
        hasPill: !!pill,
        insetLeft: pr ? Math.round(pr.left) : -1,
        insetRight: pr ? Math.round(window.innerWidth - pr.right) : -1,
        bottomGap: pr ? Math.round(window.innerHeight - pr.bottom) : -1,
        shadow: pill ? getComputedStyle(pill).boxShadow : "",
        navBackdrop: getComputedStyle(el).backdropFilter,
        pillBackdrop: pill ? getComputedStyle(pill).backdropFilter : "",
        targets: links.map((a) => {
          const r = a.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height) };
        }),
      };
    });

    // iOS 26 shape: a floating pill inset from every edge, not a bar welded to
    // the bottom. A flush full-width bar with an underline is the Material
    // idiom and is what this used to be.
    expect(m.hasPill).toBe(true);
    expect(m.insetLeft).toBeGreaterThan(8);
    expect(m.insetRight).toBeGreaterThan(8);
    expect(m.bottomGap).toBeGreaterThan(4);

    // The shadow used to be declared as a Tailwind arbitrary composite and
    // computed to `rgba(0,0,0,0) 0px 0px 0px 0px` — fully transparent, painting
    // nothing, for months. This repo has hit that same v4 trap three times
    // (.v2-shadow-board, .app-chrome-glass, this). A class name is not proof
    // that a style renders, so assert the computed value.
    expect(m.shadow).not.toBe("none");
    expect(m.shadow).not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\)\s*0px\s*0px\s*0px\s*0px/);

    // The bar is opaque, so a backdrop-filter blurs nothing and costs a
    // compositing layer for it. It carried `backdrop-blur-md` for exactly that
    // no benefit.
    expect(m.navBackdrop).toBe("none");
    expect(m.pillBackdrop).toBe("none");

    // Shrinking a full-width bar into an inset pill is the obvious way to push
    // touch targets under the 44px floor.
    expect(m.targets).toHaveLength(4);
    for (const t of m.targets) {
      expect(t.h).toBeGreaterThanOrEqual(44);
      expect(t.w).toBeGreaterThanOrEqual(44);
    }

    await expectNoPageHorizontalScroll(page);
  });

  test("opening the sheet does not draw a focus ring on the close button", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("pegana:onboarding_v1", "dismissed");
      } catch {
        return;
      }
    });
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await page.locator('button[aria-controls="mobile-menu-dialog"]').tap();
    await expect(page.locator("#mobile-menu-dialog")).toBeVisible();

    // globals.css draws :focus-visible as a 2px SOLID WHITE outline, and that
    // selector matches PROGRAMMATIC focus. showModal() hands focus to the first
    // focusable descendant, which is the close X, so tapping the burger used to
    // paint a white square around it. Focus belongs on the dialog until the
    // user actually reaches for the keyboard.
    const m = await page.evaluate(() => {
      const dialog = document.querySelector("#mobile-menu-dialog");
      const close = Array.from(
        document.querySelectorAll('button[aria-label="Close menu"]'),
      ).find((b) => b.getBoundingClientRect().height > 0) as HTMLElement | undefined;
      return {
        focusIsDialog: document.activeElement === dialog,
        closeShowsRing: close ? close.matches(":focus-visible") : null,
      };
    });

    expect(m.closeShowsRing).toBe(false);
    expect(m.focusIsDialog).toBe(true);
  });

  test("asset detail uses its contextual bottom CTA instead of the global tab bar", async ({
    page,
  }) => {
    await page.goto("/asset/jitoSOL", { waitUntil: "domcontentloaded" });

    await expect(page.locator("h1").first()).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("navigation", { name: "Mobile app navigation" }),
    ).toHaveCount(0);
    await expectNoPageHorizontalScroll(page);
  });
});
