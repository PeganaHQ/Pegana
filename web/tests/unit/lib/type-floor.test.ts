import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Accessibility floor: no text smaller than 12px in the v2 organisms
// (landing + shared chrome). Source scan so a regression fails CI.
const ROOT = join(process.cwd(), "components/organisms/v2");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

describe("v2 type floor", () => {
  it("has no text-[<12px] classes in components/organisms/v2", () => {
    const bad: string[] = [];
    const re = /text-\[(\d+(?:\.\d+)?)px\]/g;
    for (const file of walk(ROOT)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(re)) {
        if (Number(m[1]) < 12) bad.push(`${file}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
