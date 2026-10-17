import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..", "..");
const SKIP = new Set([
  "node_modules",
  ".next",
  "worktrees",
  "test-results",
  "tests",
]);

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
      if (!/\.tsx$/.test(entry)) continue;
      out.push({
        rel: full.slice(WEB_ROOT.length + 1),
        src: readFileSync(full, "utf8"),
      });
    }
  };
  for (const d of ["app", "components"]) walk(join(WEB_ROOT, d));
  return out;
}

/**
 * The 26px section heading must declare its own line-height.
 *
 * It is described in two places — a `text-[26px] font-medium
 * tracking-[-0.02em]` utility stack across a dozen files, and `.v2-in-prose h2`
 * in the marketing stylesheet — and neither used to set one. Each inherited
 * from whatever wrapped it, so the SAME heading measured 45.5px of line-height
 * on /methodology (1.75, from the prose container) and 39px on /status (1.5,
 * from body). Nothing was broken; it just read as two different typefaces of
 * the same size on two pages of one product.
 *
 * Display type sets its own leading. Body leading on a 26px heading is the
 * specific symptom.
 */
describe("the 26px display heading declares its leading", () => {
  it("every utility-styled instance carries a leading- class", () => {
    const offenders: string[] = [];
    for (const { rel, src } of sources()) {
      // Opening h2 tags carrying the 26px display stack, at either breakpoint.
      const tags = src.match(/<h2[^>]*text-\[2[26]px\][^>]*>/g) ?? [];
      for (const tag of tags) {
        if (!/\bleading-/.test(tag)) offenders.push(`${rel}: ${tag.slice(0, 90)}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the prose stylesheet's twin declares one too", () => {
    const css = readFileSync(
      join(WEB_ROOT, "app", "(marketing)", "v2.css"),
      "utf8",
    );
    const rule = css.slice(
      css.indexOf(".v2-in-prose h2 {"),
      css.indexOf("}", css.indexOf(".v2-in-prose h2 {")),
    );
    expect(rule).toContain("font-size: 26px");
    expect(rule, ".v2-in-prose h2 must set its own line-height").toMatch(
      /line-height:/,
    );
  });
});
