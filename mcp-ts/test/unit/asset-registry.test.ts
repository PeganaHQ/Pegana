import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAssetsToml } from "../../scripts/assets-toml";
import {
  ASSET_REGISTRY,
  missingSnapshotMessage,
  registryEntry,
} from "@/shared/asset-registry";
import { symbolSchema } from "@/shared/symbol";

const here = dirname(fileURLToPath(import.meta.url));
const tomlPath = resolve(here, "../../../assets.toml");

describe("asset registry", () => {
  it("matches the repo-root assets.toml exactly (run scripts/gen-asset-registry.ts on drift)", () => {
    const fromToml = parseAssetsToml(readFileSync(tomlPath, "utf8"));
    expect(ASSET_REGISTRY).toEqual(fromToml);
  });

  it("knows the sources the R1 audit found misdescribed", () => {
    expect(registryEntry("USDS")?.class).toBe("stable_cdp");
    expect(registryEntry("USDS")?.intrinsic.kind).toBe("fixed_1_usd");
    expect(registryEntry("USDC")?.market).toEqual({ kind: "pyth_spot", feed: "USDC/USD" });
    expect(registryEntry("sUSD")?.market.kind).toBe("dex_screener_usd");
    expect(registryEntry("jitoSOL")?.intrinsic.kind).toBe("spl_stake_pool");
    expect(registryEntry("BRZ")?.active).toBe(false);
  });

  it("words a missing snapshot by what is known about the symbol", () => {
    expect(missingSnapshotMessage("EURC")).toMatch(/is tracked but has no live snapshot yet/);
    expect(missingSnapshotMessage("BRZ")).toMatch(/listed but inactive/);
    expect(missingSnapshotMessage("NOPE")).toMatch(/'NOPE' not tracked/);
  });

  it("every tracked symbol passes the shared symbol input schema", () => {
    for (const e of ASSET_REGISTRY) {
      expect(symbolSchema().safeParse(e.symbol).success, e.symbol).toBe(true);
    }
  });
});
