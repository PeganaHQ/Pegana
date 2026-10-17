import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

/**
 * Em-dash guard for visible copy.
 *
 * DESIGN.md rule: "Zero em-dashes in visible copy." Em-dashes (—, &mdash;)
 * are banned from all user-facing text: JSX text nodes, string literals that
 * render to the DOM, template expressions, aria-labels, alt text, metadata
 * titles/descriptions, and error messages. They are still permitted inside
 * code comments (// or /* *\/) and JSDoc blocks.
 *
 * This test walks `app/` and `components/` recursively, strips comment lines,
 * then asserts no em-dash character or HTML entity remains in the source.
 */

const ROOTS = ["app", "components", "lib"] as const;
const EXTS = new Set([".tsx", ".ts"]);

/** Recursively collect source files under a directory. */
function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      walk(full, acc);
    } else if (EXTS.has(extname(full))) {
      acc.push(full);
    }
  }
  return acc;
}

/** Strip JS/TS comment blocks and line comments from source text. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments /* … */
    .replace(/\/\/.*$/gm, ""); // line comments //…
}

const files: string[] = [];
for (const root of ROOTS) {
  try {
    files.push(...walk(join(process.cwd(), root)));
  } catch {
    // Directory may not exist in some test environments.
  }
}

describe("em-dash guard — no em-dashes in visible copy", () => {
  it.each(files)("%s has no em-dashes outside comments", (file) => {
    const raw = readFileSync(file, "utf8");
    const stripped = stripComments(raw);
    expect(
      stripped,
      `${file} contains an em-dash (—) in visible code. Use a period, comma, or hyphen instead. See DESIGN.md §0 rule: "Zero em-dashes in visible copy."`,
    ).not.toContain("\u2014");
  });

  it.each(files)("%s has no &mdash; HTML entity", (file) => {
    const raw = readFileSync(file, "utf8");
    const stripped = stripComments(raw);
    expect(
      stripped,
      `${file} contains &mdash; in visible code. Use a period, comma, or hyphen instead.`,
    ).not.toContain("&mdash;");
  });
});
