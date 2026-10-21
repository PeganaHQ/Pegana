import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Accessibility floor: no text smaller than 12px on the marketing surface.
// Source scan so a regression fails CI. Covers:
//   1. the v2 organisms (landing + shared chrome), Tailwind `text-[Npx]`;
//   2. the marketing stylesheet app/(marketing)/v2.css, every `font-size`
//      declaration in px or rem, and the minimum (first) argument of clamp();
//   3. every .tsx file under app/(marketing)/**, Tailwind `text-[Npx]` and
//      `text-[Nrem]` arbitrary sizes.
const CWD = process.cwd();
const FLOOR_PX = 12;
const REM_PX = 16;

const V2_ORGANISMS = join(CWD, "components/organisms/v2");
const LST_ORGANISMS = join(CWD, "components/organisms/lst");
const MARKETING = join(CWD, "app/(marketing)");
const V2_CSS = join(MARKETING, "v2.css");

function walk(dir: string, re: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p, re) : re.test(name) ? [p] : [];
  });
}

function toPx(value: string, unit: string): number {
  const n = Number(value);
  return unit === "rem" ? n * REM_PX : n;
}

/** Sub-floor Tailwind arbitrary text sizes in a source file. */
function tailwindViolations(src: string): string[] {
  const re = /text-\[(\d+(?:\.\d+)?)(px|rem)\]/g;
  return [...src.matchAll(re)]
    .filter((m) => toPx(m[1], m[2]) < FLOOR_PX)
    .map((m) => m[0]);
}

/** Sub-floor `font-size` declarations in a stylesheet (px, rem, clamp min).
 *  Relative `em`/`%` sizes (e.g. inline <code> at 0.82em of its prose) scale
 *  with a parent that is itself scanned, so they are out of scope here. */
function cssViolations(css: string): string[] {
  const bad: string[] = [];
  const decl = /font-size\s*:\s*([^;}]+)/g;
  for (const m of css.matchAll(decl)) {
    const value = m[1].trim();
    const clamp = /^clamp\(\s*(\d+(?:\.\d+)?)(px|rem)/.exec(value);
    const plain = /^(\d+(?:\.\d+)?)(px|rem)\b/.exec(value);
    const hit = clamp ?? plain;
    if (hit && toPx(hit[1], hit[2]) < FLOOR_PX) bad.push(`font-size: ${value}`);
  }
  return bad;
}

// Explicit allowlist for app/(marketing)/**/*.tsx: path (relative to web/) ->
// the MAXIMUM number of sub-12px occurrences tolerated. A ratchet: a new
// violation anywhere fails, and the test also fails on a stale, over-generous
// entry, so the baseline can only shrink. Delete each entry at 0.
const MARKETING_TSX_ALLOWLIST: Record<string, number> = {};

describe("v2 type floor", () => {
  it("has no text-[<12px] classes in components/organisms/v2", () => {
    const bad: string[] = [];
    for (const file of walk(V2_ORGANISMS, /\.tsx?$/)) {
      for (const hit of tailwindViolations(readFileSync(file, "utf8"))) {
        bad.push(`${file}: ${hit}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("has no text-[<12px] classes in components/organisms/lst", () => {
    const bad: string[] = [];
    for (const file of walk(LST_ORGANISMS, /\.tsx?$/)) {
      for (const hit of tailwindViolations(readFileSync(file, "utf8"))) {
        bad.push(`${file}: ${hit}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("has no font-size below 12px in app/(marketing)/v2.css", () => {
    expect(cssViolations(readFileSync(V2_CSS, "utf8"))).toEqual([]);
  });

  it("has no text-[<12px] in app/(marketing)/**/*.tsx beyond the allowlist", () => {
    const over: string[] = [];
    const counts: Record<string, number> = {};
    for (const file of walk(MARKETING, /\.tsx$/)) {
      const rel = relative(CWD, file);
      const hits = tailwindViolations(readFileSync(file, "utf8"));
      counts[rel] = hits.length;
      const allowed = MARKETING_TSX_ALLOWLIST[rel] ?? 0;
      if (hits.length > allowed) {
        over.push(
          `${rel}: ${hits.length} > allowed ${allowed} (${hits.join(", ")})`,
        );
      }
    }
    expect(over).toEqual([]);

    const stale = Object.entries(MARKETING_TSX_ALLOWLIST)
      .filter(([rel, n]) => (counts[rel] ?? 0) < n)
      .map(([rel, n]) => `${rel}: allowlist ${n}, actual ${counts[rel] ?? 0}`);
    expect(stale).toEqual([]);
  });

  it("the css scanner catches px, rem and clamp minimums", () => {
    expect(
      cssViolations(
        ".a{font-size:11px}.b{font-size: 0.7rem;}.c{font-size:clamp(10px,2vw,20px)}.d{font-size:12px}.e{font-size:0.82em}",
      ),
    ).toEqual([
      "font-size: 11px",
      "font-size: 0.7rem",
      "font-size: clamp(10px,2vw,20px)",
    ]);
  });
});
