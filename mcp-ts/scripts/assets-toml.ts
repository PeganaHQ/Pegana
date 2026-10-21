// Minimal reader for the repo-root assets.toml, used to generate
// src/shared/asset-registry.ts and by the drift test that keeps the two in
// sync. It understands exactly the subset assets.toml uses: `[[assets]]`
// tables of one-line `key = value` pairs, where a value is a string, a
// boolean, a number or a one-line inline table of those. Anything else is
// ignored, which is fine because only the keys below are extracted.

import type { AssetRegistryEntry } from "../src/shared/asset-registry";

type Scalar = string | number | boolean;

function parseScalar(raw: string): Scalar {
  const v = raw.trim();
  if (v.startsWith('"')) return JSON.parse(v) as string;
  if (v === "true") return true;
  if (v === "false") return false;
  const n = Number(v);
  if (!Number.isNaN(n)) return n;
  throw new Error(`unsupported TOML value: ${v}`);
}

/** Strip a trailing `# comment` that is not inside a string. */
function stripComment(line: string): string {
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i - 1] !== "\\") inStr = !inStr;
    if (ch === "#" && !inStr) return line.slice(0, i);
  }
  return line;
}

/** Split `a = "x", b = true` on top-level commas. */
function splitPairs(body: string): string[] {
  const out: string[] = [];
  let inStr = false;
  let cur = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === '"' && body[i - 1] !== "\\") inStr = !inStr;
    if (ch === "," && !inStr) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function parseValue(raw: string): Scalar | Record<string, Scalar> {
  const v = raw.trim();
  if (v.startsWith("{") && v.endsWith("}")) {
    const table: Record<string, Scalar> = {};
    for (const pair of splitPairs(v.slice(1, -1))) {
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      table[pair.slice(0, eq).trim()] = parseScalar(pair.slice(eq + 1));
    }
    return table;
  }
  return parseScalar(v);
}

const SOURCE_KEYS = ["kind", "feed", "invert", "numeraire", "numeraire_feed"] as const;

function pickSource(
  table: Record<string, Scalar>,
): AssetRegistryEntry["intrinsic"] {
  const out: Record<string, Scalar> = {};
  for (const k of SOURCE_KEYS) if (k in table) out[k] = table[k]!;
  if (typeof out.kind !== "string") throw new Error(`source without kind: ${JSON.stringify(table)}`);
  return out as unknown as AssetRegistryEntry["intrinsic"];
}

export function parseAssetsToml(text: string): AssetRegistryEntry[] {
  const rows: Record<string, unknown>[] = [];
  let cur: Record<string, unknown> | null = null;
  for (const rawLine of text.split("\n")) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    if (line.startsWith("[[")) {
      cur = line === "[[assets]]" ? {} : null;
      if (cur) rows.push(cur);
      continue;
    }
    if (line.startsWith("[")) {
      cur = null; // some other table: not part of an asset entry
      continue;
    }
    if (!cur) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!["symbol", "class", "peg_target", "intrinsic", "market", "active"].includes(key)) {
      continue;
    }
    cur[key] = parseValue(line.slice(eq + 1));
  }
  return rows.map((r) => {
    if (typeof r.symbol !== "string" || typeof r.class !== "string") {
      throw new Error(`asset entry without symbol/class: ${JSON.stringify(r)}`);
    }
    return {
      symbol: r.symbol,
      class: r.class as AssetRegistryEntry["class"],
      peg_target: r.peg_target as AssetRegistryEntry["peg_target"],
      active: r.active === undefined ? true : r.active === true,
      intrinsic: pickSource(r.intrinsic as Record<string, Scalar>),
      market: pickSource(r.market as Record<string, Scalar>),
    };
  });
}
