import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { parse as parseToml } from "smol-toml";

// CI guard: every ACTIVE mint in assets.toml must have a vendored, non-monogram
// icon. Adding an asset without running `bun run icons:sync` (or an override)
// fails here. Runs from web/ (vitest cwd).
const WEB_ROOT = process.cwd();
const REPO_ROOT = resolve(WEB_ROOT, "..");
const TOKENS = join(WEB_ROOT, "public", "tokens");

const toml = parseToml(
  readFileSync(join(REPO_ROOT, "assets.toml"), "utf8"),
) as {
  assets: { symbol: string; mint: string; active?: boolean }[];
};
const activeAssets = toml.assets.filter((a) => a.active !== false);

const manifest = JSON.parse(
  readFileSync(join(TOKENS, "manifest.json"), "utf8"),
) as {
  mint: string;
  symbol: string;
  source: string;
}[];
const bySource = new Map(manifest.map((m) => [m.mint, m.source]));

describe("token-icon coverage", () => {
  it("vendored at least the active asset count", () => {
    expect(manifest.length).toBeGreaterThanOrEqual(activeAssets.length);
  });

  it.each(activeAssets.map((a) => [a.symbol, a.mint] as const))(
    "%s has a real (non-monogram) vendored webp",
    (_symbol, mint) => {
      expect(existsSync(join(TOKENS, `${mint}.webp`))).toBe(true);
      expect(bySource.get(mint)).toBeDefined();
      expect(bySource.get(mint)).not.toBe("monogram");
    },
  );
});
