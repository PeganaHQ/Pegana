import { defineConfig, devices } from "@playwright/test";

/**
 * Pegana web E2E config.
 *
 * Tests assume the *backend* is already running and reachable at the
 * `NEXT_PUBLIC_API_BASE` / `NEXT_PUBLIC_WS_URL` configured in `.env.local`.
 * The simplest local setup: `docker compose -p pegana-prodlocal -f
 * docker-compose.yml -f docker-compose.local.yml up -d` before running.
 *
 * The `webServer` block below boots Next dev on demand so `pnpm test:e2e`
 * works without pre-starting the frontend; CI can pass `reuseExistingServer`
 * to attach to one already up.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const EXTERNAL_TARGET = process.env.PLAYWRIGHT_EXTERNAL_TARGET === "1";
const projects = [
  {
    name: "chromium",
    use: { ...devices["Desktop Chrome"] },
  },
  ...(process.env.IOS_E2E === "1"
    ? [
        {
          name: "webkit-iphone",
          use: { ...devices["iPhone 13"] },
        },
      ]
    : []),
];

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { outputFolder: "playwright-report", open: "never" }],
        [
          "json",
          {
            outputFile:
              process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ??
              "test-results/results.json",
          },
        ],
      ]
    : "list",
  // Headroom for Next dev's on-demand route compilation (first hit to a route
  // compiles it) so a cold route doesn't trip the per-test timeout in CI.
  timeout: 45_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects,
  ...(EXTERNAL_TARGET
    ? {}
    : {
        webServer: {
          command: "bun run dev",
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          // Next 16 dev cold-start (Sentry wrap + first compile) can exceed 60s on a
          // cold CI runner — give it room so the whole suite doesn't fail at boot.
          timeout: 120_000,
          stdout: "ignore" as const,
          stderr: "pipe" as const,
        },
      }),
});
