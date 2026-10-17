import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..", "..");
const SKIP = new Set(["node_modules", ".next", "worktrees", "test-results"]);

/**
 * An unknown number must not be displayed as zero.
 *
 * `formatGap` and `holderSignedPct` both return "-" for null on purpose: this
 * product's claim is that missing data never looks like confirming data. Piping
 * `?? 0` into them defeats exactly that, and silently — the spread tape did it
 * for months. It even computed `hasBps` correctly and used it only to choose a
 * colour, so a missing or stale spread printed a muted "0.00%": in a peg-risk
 * product, the single most reassuring value there is, rendered from data we did
 * not have.
 *
 * Zero is a real, meaningful reading here. It has to be earned.
 */

const OFFENDING = [
  // `formatGap(x ?? 0)`, `holderSignedPct(x || 0)`, and the same across a line
  // break, which is how prettier tends to leave them.
  // No `s` flag: `[^)]` already matches newlines, and the flag needs an es2018
  // target this tsconfig does not set — it broke `tsc` on main for two commits
  // because I piped typecheck into `tail` before `&&`, so the chain read the
  // pipe's exit status instead of the compiler's.
  /\b(formatGap|holderSignedPct)\s*\(\s*[^)]*?(\?\?|\|\|)\s*0\b/,
];

function sources(): { rel: string; src: string }[] {
  const out: { rel: string; src: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      out.push({
        rel: full.slice(WEB_ROOT.length + 1),
        src: readFileSync(full, "utf8"),
      });
    }
  };
  for (const d of ["app", "components", "lib"]) walk(join(WEB_ROOT, d));
  return out;
}

describe("an unknown number is not displayed as zero", () => {
  it("scans a real number of files", () => {
    // Without this the whole check passes vacuously if the walk breaks.
    expect(sources().length).toBeGreaterThan(100);
  });

  it("no display helper is fed a zero default", () => {
    const offenders: string[] = [];
    for (const { rel, src } of sources()) {
      // Comments discuss this bug by name; only code should be matched.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const re of OFFENDING) {
        const m = code.match(re);
        if (m) {
          offenders.push(
            `${rel}: ${m[0].replace(/\s+/g, " ").slice(0, 90)}\n` +
              `  → these helpers already return "-" for null. Pass the null ` +
              `through, or gate the render on a real value.`,
          );
        }
      }
    }
    expect(offenders, offenders.join("\n\n")).toEqual([]);
  });
});
