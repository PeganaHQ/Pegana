import type { DirectoryLstRaw } from "./types";

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Defensive parse of lst-directory.com's raw `rows[]` array. This is a
 * third-party upstream Pegana doesn't control — a single malformed row (or a
 * schema field that quietly changed type) shouldn't blank the whole
 * directory, so anything shaped wrong is dropped rather than thrown.
 * `mint`/`symbol` are the only required fields; everything else degrades to
 * a safe default (never fabricated — `null` numbers stay `null`).
 */
export function parseDirectoryRows(input: unknown): DirectoryLstRaw[] {
  if (!Array.isArray(input)) return [];
  const out: DirectoryLstRaw[] = [];

  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;

    const mint = asString(r.mint);
    const symbol = asString(r.symbol);
    if (!mint || !symbol) continue;

    const flagsRaw =
      r.flags && typeof r.flags === "object"
        ? (r.flags as Record<string, unknown>)
        : {};

    out.push({
      mint,
      symbol,
      name: asString(r.name) ?? symbol,
      logoUri: asString(r.logoUri),
      poolProgram: asString(r.poolProgram),
      tvlUsd: asNumber(r.tvlUsd),
      apy: asNumber(r.apy),
      rate: asNumber(r.rate),
      flags: {
        deprecated: flagsRaw.deprecated === true,
        dead: flagsRaw.dead === true,
        stale: flagsRaw.stale === true,
      },
    });
  }

  return out;
}
