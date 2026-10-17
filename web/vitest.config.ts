import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "tests/e2e/**",
      // Playwright specs against live production hosts. They import
      // @playwright/test, which vitest cannot run.
      "tests/public/**",
      // Stale git worktrees (left by prior workflow runs) carry their own copy
      // of the suite; without this their files get matched by filename filters
      // and fail to resolve the `@` alias against this root.
      ".claude/**",
      "worktrees/**",
    ],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
