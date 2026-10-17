import { defineConfig, devices } from "@playwright/test";

/**
 * Public-surface config. Separate from `playwright.config.ts` on purpose.
 *
 * These specs hit LIVE production hostnames over absolute URLs, so they need no
 * local server — and must never start one. The main config's `webServer` block
 * runs `bun run dev`, which is banned on this machine (it has crashed it). A
 * separate config is the only way to guarantee that never happens by accident.
 *
 * Run: `bun run verify:public` (after any deploy that touches proxy.ts,
 * vercel.json, next.config.ts, or the CSP).
 */
export default defineConfig({
  testDir: "./tests/public",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Production over the public internet: one retry absorbs a transient blip
  // without letting a real regression pass.
  retries: 1,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Both engines. The Telegram white-ring and several mobile bugs reproduced
  // ONLY in WebKit, so a Chromium-only check is not evidence about iOS.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit-iphone", use: { ...devices["iPhone 13"] } },
  ],
});
