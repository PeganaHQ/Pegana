import type { PegState } from "@/lib/api/types";

// /lst — the public LST peg-risk directory. Two independent data sources
// merged server-side: the universe + TVL/APY (lst-directory.com, maintained
// by Hylo) and Pegana's own live verdict overlay (/v1/assets?class=lst).
// Deliberately NOT re-using AssetCardData here — the directory's raw
// per-issuer payload carries fields (holders, apyHistory, breakdown, ...)
// this page has no use for, and a dedicated row type keeps the merge
// (lib/lst/merge.ts) trivial to unit-test without dragging in unrelated
// upstream shape.

export interface DirectoryFlags {
  deprecated: boolean;
  dead: boolean;
  /** The directory maintainer's own liveness determination: the LST's rate
   *  has stopped updating on-chain. This is the intrinsic-side analogue of a
   *  stale oracle — a frozen-but-served backing (the 2026-04-01 dSOL failure
   *  mode). Drives the amber INTRINSIC_DEGRADED advisory. */
  stale: boolean;
}

/** One row from lst-directory.com's `GET /api/directory` `rows[]`. Only the
 *  fields this page actually reads — the live payload ships a lot more
 *  (holders, apyHistory, breakdown, ratePrev, ...) that parseDirectoryRows
 *  deliberately drops. */
export interface DirectoryLstRaw {
  mint: string;
  symbol: string;
  name: string;
  logoUri: string | null;
  poolProgram: string | null;
  tvlUsd: number | null;
  apy: number | null;
  rate: number | null;
  flags: DirectoryFlags;
}

/**
 * One ranked row on /lst: a directory LST, optionally overlaid with
 * Pegana's live verdict when we track it. `covered === false` means Pegana
 * doesn't cover this LST yet — render "not yet covered", never a fabricated
 * state.
 */
export interface LstDirectoryRow {
  mint: string;
  symbol: string;
  name: string;
  logoUri: string | null;
  tvlUsd: number | null;
  apy: number | null;
  rate: number | null;
  deprecated: boolean;
  dead: boolean;
  covered: boolean;
  /** Pegana's own symbol for this asset (drives `/asset/<symbol>`) — kept
   *  separate from `symbol` because casing can differ between the two APIs
   *  even on a confirmed mint match (e.g. directory "JitoSOL" vs Pegana
   *  "jitoSOL"). Null when `covered` is false. */
  peganaSymbol: string | null;
  state: PegState | null;
  /** Market's premium(+)/discount(−) to NAV, in bps, in the holder convention:
   *  positive = trading ABOVE its staked-SOL value (premium), negative = BELOW
   *  (discount). NOTE: this is the NEGATION of Pegana's internal
   *  `discount`/reconcileBps sign — the flip lives in merge.ts `verdictFrom`. */
  spreadBps: number | null;
  updatedAt: string | null;
}
