import { test, expect } from "@playwright/test";

test.describe("Landing — reduced motion", () => {
  test("renders without GSAP entrance animation when reduce is preferred", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto("/");

    const h1 = page.getByRole("heading", {
      level: 1,
      name: /Prove the peg of every asset you hold\./i,
    });
    await expect(h1).toBeVisible({ timeout: 2000 });
    await expect(
      page.getByRole("heading", {
        name: /Where the numbers come from\./i,
      }),
    ).toBeVisible({ timeout: 2000 });
    await expect(
      page.getByRole("heading", {
        name: /One signal, three ways to consume it\./i,
      }),
    ).toBeVisible({ timeout: 2000 });

    await ctx.close();
  });
});
