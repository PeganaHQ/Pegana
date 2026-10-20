import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CURATED_TOKENS } from "@/lib/landing/curated-tokens";

const fixture: Array<{ symbol: string; mint: string; class: string }> =
  JSON.parse(
    readFileSync(
      join(process.cwd(), "tests/fixtures/landing-assets-snapshot.json"),
      "utf8",
    ),
  );

describe("curated landing tokens", () => {
  it("is exactly eight tokens with unique mints", () => {
    expect(CURATED_TOKENS).toHaveLength(8);
    expect(new Set(CURATED_TOKENS.map((t) => t.mint)).size).toBe(8);
  });

  it.each(CURATED_TOKENS.map((t) => [t.symbol, t] as const))(
    "%s has an icon file and is in the live asset list",
    (_s, t) => {
      expect(existsSync(join(process.cwd(), "public/tokens", `${t.mint}.webp`))).toBe(true);
      const row = fixture.find((a) => a.mint === t.mint);
      expect(row?.symbol).toBe(t.symbol);
      expect(row?.class).toBe(t.klass);
    },
  );
});
