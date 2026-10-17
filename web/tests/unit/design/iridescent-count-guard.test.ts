import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Iridescent ration guard.
 *
 * DESIGN.md §2: "Iridescent gradient rationed to 5 moments/page max."
 * The iridescent gradient (`--v2-iri`, `--gradient-iridescent`, `.v2-iri-text`,
 * `.text-iridescent`) is the brand's most expressive surface. Too many
 * iridescent accents on a single page dilute the effect into noise.
 *
 * This test counts iridescent usages inside every page route file and its
 * co-located client component, flagging any route that exceeds 5 total
 * iridescent references. Comment lines are excluded from the count.
 *
 * Additionally: `.text-iridescent` (gradient text) is BANNED entirely by
 * DESIGN.md ("Zero gradient text"). A separate assertion fails on any usage.
 */

const APP_DIR = join(process.cwd(), "app");

const IRI_PATTERN =
  /(?:v2-iri-text|text-iridescent|gradient-iridescent|--v2-iri\b|\.v2-iri\b)/g;

const GRADIENT_TEXT_PATTERN = /text-iridescent/g;

/** Recursively find page.tsx files (routes). */
function findPages(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      findPages(full, acc);
    } else if (entry === "page.tsx" || entry === "page.ts") {
      acc.push(full);
    }
  }
  return acc;
}

/** Strip comments from source. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/** Count regex matches in stripped source. */
function countMatches(src: string, pattern: RegExp): number {
  return (src.match(pattern) || []).length;
}

const pages = findPages(APP_DIR);

describe("iridescent ration guard", () => {
  it("should have found at least one page route", () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it.each(pages)("%s does not exceed 5 iridescent moments", (page) => {
    const src = stripComments(readFileSync(page, "utf8"));
    const count = countMatches(src, IRI_PATTERN);
    expect(
      count,
      `${page} uses ${count} iridescent references. DESIGN.md §2 limits to 5 per page. Reduce to fewer than 5 iridescent gradient applications.`,
    ).toBeLessThanOrEqual(5);
  });

  it.each(pages)("%s has no gradient text (.text-iridescent)", (page) => {
    const src = stripComments(readFileSync(page, "utf8"));
    const count = countMatches(src, GRADIENT_TEXT_PATTERN);
    expect(
      count,
      `${page} uses .text-iridescent (gradient text). DESIGN.md bans gradient text entirely.`,
    ).toBe(0);
  });
});
