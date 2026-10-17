import type { AssetClass } from "@/lib/api/types";

export interface CanonAssetMeta {
  symbol: string;
  name: string;
  mint: string;
  className: string;
  pegTarget: string;
  active: boolean;
  verified: boolean;
}

const ICON_CLASSES = new Set<AssetClass>([
  "lst",
  "stable_fiat",
  "stable_cdp",
  "stable_rwa",
  "stable_dn",
  "synth_lev",
  "stable_yield",
]);

export function assetClassForIcon(
  className: string | null | undefined,
): AssetClass | undefined {
  return ICON_CLASSES.has(className as AssetClass)
    ? (className as AssetClass)
    : undefined;
}

export function findCanonAsset(
  assets: CanonAssetMeta[],
  symbol: string,
): CanonAssetMeta | undefined {
  return (
    assets.find((a) => a.symbol === symbol) ??
    assets.find((a) => a.symbol.toLowerCase() === symbol.toLowerCase())
  );
}

export function parseAssetsToml(toml: string): CanonAssetMeta[] {
  const assets: CanonAssetMeta[] = [];
  let current: Partial<CanonAssetMeta> & { hasSymbol?: boolean } = {};

  const flush = () => {
    if (current.hasSymbol) {
      const symbol = current.symbol ?? "?";
      assets.push({
        symbol,
        name: current.name ?? symbol,
        mint: current.mint ?? "",
        className: current.className ?? "?",
        pegTarget: current.pegTarget ?? "?",
        active: current.active ?? true,
        verified: current.verified ?? false,
      });
    }
    current = {};
  };

  for (const rawLine of toml.split("\n")) {
    const line = rawLine.trim();
    if (line === "[[assets]]") {
      flush();
      continue;
    }
    if (line.startsWith("[") && line !== "[[assets]]") {
      flush();
      continue;
    }

    const match = line.match(
      /^([A-Za-z_]+)\s*=\s*(?:"([^"]*)"|([^#\s]+))\s*(?:#.*)?$/,
    );
    if (!match) continue;

    const [, key, quoted, bare] = match;
    const value = quoted ?? bare ?? "";
    switch (key) {
      case "symbol":
        current.symbol = value;
        current.hasSymbol = true;
        break;
      case "name":
        current.name = value;
        break;
      case "mint":
        current.mint = value;
        break;
      case "class":
        current.className = value;
        break;
      case "peg_target":
        current.pegTarget = value;
        break;
      case "active":
        current.active = value === "true";
        break;
      case "verified":
        current.verified = value === "true";
        break;
    }
  }
  flush();
  return assets;
}
