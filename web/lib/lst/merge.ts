import type { AssetCardData, PegState } from "@/lib/api/types";
import { reconcileBps } from "@/lib/api/format";
import type { DirectoryLstRaw, LstDirectoryRow } from "./types";

function normSymbol(s: string): string {
  return s.trim().toLowerCase();
}

interface Verdict {
  state: PegState | null;
  spreadBps: number | null;
  updatedAt: string | null;
}

const NO_VERDICT: Verdict = { state: null, spreadBps: null, updatedAt: null };

function verdictFrom(asset: AssetCardData): Verdict {
  const raw = reconcileBps(asset).bps;
  return {
    state: asset.state,
    // reconcileBps / the API's `discount` field are signed (intrinsic − market):
    // POSITIVE means the market trades BELOW NAV (a real discount), NEGATIVE
    // means ABOVE NAV (a premium) — see navSideFromBps in asset-hero-v2. For a
    // holder-facing row we flip to the intuitive convention: `+` = premium
    // (trading above its staked-SOL value), `−` = discount (below it). Without
    // this flip a healthy LST at a +1% premium rendered as a scary "−1%".
    spreadBps: raw == null ? null : -raw,
    updatedAt: asset.updated_at,
  };
}

function sortByTvlDesc(rows: LstDirectoryRow[]): LstDirectoryRow[] {
  // Missing TVL (`null`) sinks to the bottom rather than being treated as 0
  // — an unranked row and a genuinely $0-TVL row aren't the same claim.
  return [...rows].sort((a, b) => {
    const at = a.tvlUsd ?? -Infinity;
    const bt = b.tvlUsd ?? -Infinity;
    return bt - at;
  });
}

/**
 * Overlay Pegana's live LST verdicts onto the lst-directory.com universe.
 * Match by mint first — base58, case-sensitive, the reliable shared key —
 * falling back to a case-insensitive symbol match (directory "JitoSOL" vs
 * Pegana "jitoSOL" is the same asset). A directory row with no match is
 * still returned, `covered: false`, `state: null` — the whole point of this
 * page is showing where Pegana's coverage ends, not hiding the gap.
 */
export function mergeLstDirectory(
  directory: DirectoryLstRaw[],
  peganaAssets: AssetCardData[],
): LstDirectoryRow[] {
  const lstAssets = peganaAssets.filter((a) => a.class === "lst");
  const byMint = new Map<string, AssetCardData>();
  const bySymbol = new Map<string, AssetCardData>();
  for (const a of lstAssets) {
    if (a.mint) byMint.set(a.mint.trim(), a);
    bySymbol.set(normSymbol(a.symbol), a);
  }

  const rows: LstDirectoryRow[] = directory.map((d) => {
    const match =
      byMint.get(d.mint.trim()) ?? bySymbol.get(normSymbol(d.symbol));
    const verdict = match ? verdictFrom(match) : NO_VERDICT;
    return {
      mint: d.mint,
      symbol: d.symbol,
      name: d.name,
      logoUri: d.logoUri,
      tvlUsd: d.tvlUsd,
      apy: d.apy,
      rate: d.rate,
      deprecated: d.flags.deprecated,
      dead: d.flags.dead,
      covered: match != null,
      peganaSymbol: match?.symbol ?? null,
      ...verdict,
    };
  });

  return sortByTvlDesc(rows);
}

/**
 * Fallback universe when lst-directory.com is unreachable: Pegana's own
 * tracked LSTs, alphabetical (no TVL to rank by, so don't invent an order
 * that implies one). Every row is `covered: true` by construction — this
 * list IS the set of LSTs Pegana rates.
 */
export function buildFallbackRows(
  peganaAssets: AssetCardData[],
): LstDirectoryRow[] {
  const rows: LstDirectoryRow[] = peganaAssets
    .filter((a) => a.class === "lst")
    .map((a) => ({
      mint: a.mint,
      symbol: a.symbol,
      name: a.name,
      logoUri: null,
      tvlUsd: null,
      apy: null,
      rate: null,
      deprecated: false,
      dead: false,
      covered: true,
      peganaSymbol: a.symbol,
      ...verdictFrom(a),
    }));

  return rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
}
