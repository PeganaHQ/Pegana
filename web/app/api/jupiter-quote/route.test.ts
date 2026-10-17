import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import { isAllowedPair, USDC_MINT, TRACKED_INPUT_MINTS } from "./allowlist";

describe("jupiter-quote allowlist", () => {
  it("allows jitoSOL → USDC (real tracked pair)", () => {
    // jitoSOL is a live, active Pegana-tracked asset; USDC is always the outputMint
    expect(
      isAllowedPair("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", USDC_MINT),
    ).toBe(true);
  });

  it("allows USDe → USDC (stablecoin tracked pair)", () => {
    expect(
      isAllowedPair("DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT", USDC_MINT),
    ).toBe(true);
  });

  it("allows JLP → USDC (Phase-0 yield-bearing pair)", () => {
    expect(
      isAllowedPair("27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4", USDC_MINT),
    ).toBe(true);
  });

  it("rejects an arbitrary pair (SOL → incinerator)", () => {
    expect(
      isAllowedPair(
        "So11111111111111111111111111111111111111112",
        "1nc1nerator11111111111111111111111111111111",
      ),
    ).toBe(false);
  });

  it("rejects a tracked inputMint with a non-USDC outputMint", () => {
    // jitoSOL is tracked but SOL is not the allowed outputMint
    expect(
      isAllowedPair(
        "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
        "So11111111111111111111111111111111111111112",
      ),
    ).toBe(false);
  });

  it("rejects a deactivated asset (BRZ, active=false in assets.toml)", () => {
    expect(
      isAllowedPair("FtgGSFADXBtroxq8VCausXRr2of47QBf5AS1NtZCu4GD", USDC_MINT),
    ).toBe(false);
  });

  it("rejects a deactivated asset (pbUSDC, active=false in assets.toml)", () => {
    expect(
      isAllowedPair("F35yYmTR6PqkbTx449P1eGhB57mRhWAdYs93eCo2dMZR", USDC_MINT),
    ).toBe(false);
  });

  it("rejects an empty string pair", () => {
    expect(isAllowedPair("", "")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Drift guard: assets.toml active mints must match the hardcoded allowlist.
//
// If you add a new active=true asset to assets.toml without updating
// TRACKED_INPUT_MINTS in allowlist.ts, this test FAILS THE BUILD and names
// the drifted mints so you know exactly what to fix.
// ---------------------------------------------------------------------------
describe("allowlist drift guard, assets.toml vs TRACKED_INPUT_MINTS", () => {
  it("active mints in assets.toml exactly match the hardcoded allowlist (symmetric diff is empty)", () => {
    // ── 1. Parse assets.toml from the repo root (4 dirs above this file) ──
    // Parser: smol-toml is already in web/package.json (^1.6.1); we use it in
    // preference to regex because TOML inline-tables and multi-line values make
    // plain-text extraction brittle (e.g. `active = false` can appear in a
    // comment, while a `mint = "..."` line with `active = false` on the SAME
    // [[assets]] stanza needs correlation). smol-toml gives us real key-value
    // semantics with zero extra dependencies.
    const tomlPath = resolve(__dirname, "../../../../assets.toml");
    const raw = readFileSync(tomlPath, "utf8");

    type AssetEntry = { mint: string; active?: boolean; symbol?: string };
    const parsed = parseToml(raw) as { assets: AssetEntry[] };

    // ── 2. Compute the active-mint set from TOML ──────────────────────────
    // Convention: `active` defaults to true when the field is absent (all
    // entries without an explicit `active = false` are considered live).
    // This mirrors how the indexer/engine treats the field.
    const tomlActiveMints = new Set<string>(
      parsed.assets.filter((a) => a.active !== false).map((a) => a.mint),
    );

    // ── 3. Symmetric diff to surface exact discrepancies ─────────────────
    const inTomlNotAllowlist = [...tomlActiveMints].filter(
      (m) => !TRACKED_INPUT_MINTS.has(m),
    );
    const inAllowlistNotToml = [...TRACKED_INPUT_MINTS].filter(
      (m) => !tomlActiveMints.has(m),
    );

    const hasDrift =
      inTomlNotAllowlist.length > 0 || inAllowlistNotToml.length > 0;

    if (hasDrift) {
      const lines: string[] = [
        "allowlist.ts and assets.toml are out of sync. Update TRACKED_INPUT_MINTS:",
      ];
      if (inTomlNotAllowlist.length > 0) {
        lines.push(
          `  ADD to allowlist (active in TOML but missing): ${inTomlNotAllowlist.join(", ")}`,
        );
      }
      if (inAllowlistNotToml.length > 0) {
        lines.push(
          `  REMOVE from allowlist (in allowlist but not active in TOML): ${inAllowlistNotToml.join(", ")}`,
        );
      }
      expect.fail(lines.join("\n"));
    }

    // Verify the TOML yielded a non-trivial set (guards against a parse no-op)
    expect(tomlActiveMints.size).toBeGreaterThan(0);
    // Counts match (redundant given symmetric diff, but makes failures obvious)
    expect(TRACKED_INPUT_MINTS.size).toBe(tomlActiveMints.size);
  });
});
