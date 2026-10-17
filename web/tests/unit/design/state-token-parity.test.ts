import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// X3 (safe): the app-root `--color-st-*` tokens (globals.css, powering the
// product app's Tailwind `st-*` utilities) and the `.pegana-v2`-scoped
// `--v2-*` tokens (v2.css, marketing/landing) are DELIBERATELY defined in
// separate cascade scopes (see v2.css's docstring — nothing there may leak
// into the product app). They carry BYTE-IDENTICAL hexes today, but nothing
// enforced that: a future contrast fix or restyle could move one and not the
// other, and unit tests that assert class strings (not computed color) would
// never catch it — the exact silent-drift risk state-meta.ts's own docstring
// warns about.
//
// Rather than the regression-prone route of collapsing the two scopes into
// one variable (the "X2" plain-CSS-loses-to-Tailwind trap), this test is the
// guard: it fails the build the moment the two namespaces disagree on any
// state hue, so the duplication stays safe without any runtime CSS change.

const ROOT = process.cwd();
const globalsCss = readFileSync(join(ROOT, "app/globals.css"), "utf8");
const v2Css = readFileSync(join(ROOT, "app/(marketing)/v2.css"), "utf8");

/** All values a `--name:` custom property is assigned in a stylesheet. */
function hexesFor(css: string, name: string): string[] {
  const re = new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})\\s*;`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) out.push(m[1]!.toLowerCase());
  return out;
}

/** Single hex for a token, asserting every definition of it agrees. */
function hex(css: string, name: string): string {
  const all = hexesFor(css, name);
  expect(all.length, `no hex for --${name}`).toBeGreaterThan(0);
  expect(
    new Set(all).size,
    `--${name} defined with conflicting hexes: ${all.join(", ")}`,
  ).toBe(1);
  return all[0]!;
}

// canonical --color-st-*  <->  .pegana-v2 --v2-*
const PAIRS: [string, string][] = [
  ["color-st-pegged", "v2-peg"],
  ["color-st-drift", "v2-drift"],
  ["color-st-depeg", "v2-depeg"],
  ["color-st-critical", "v2-crit"],
  ["color-st-unknown", "v2-unk"],
];

describe("state-token parity — --color-st-* (app) vs --v2-* (.pegana-v2)", () => {
  it("both stylesheets define the state tokens self-consistently", () => {
    // globals.css intentionally repeats --color-st-* in @theme AND :root;
    // hex() above asserts each token's repeats agree.
    for (const [st] of PAIRS) hex(globalsCss, st);
    for (const [, v2] of PAIRS) hex(v2Css, v2);
  });

  it.each(PAIRS)("--%s (globals) === --%s (v2)", (stName, v2Name) => {
    expect(hex(globalsCss, stName)).toBe(hex(v2Css, v2Name));
  });
});
