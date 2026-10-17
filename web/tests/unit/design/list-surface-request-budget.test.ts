import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(WEB_ROOT, rel), "utf8");

/**
 * Source with comments removed. Both files below DISCUSS `<h1>` in prose that
 * explains this very bug, so a naive match reads the explanation as if it were
 * the element: the negative assertion failed on a comment, and the positive one
 * would have passed on a comment. Neither would have been about the code.
 */
const readCode = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/**
 * A surface that renders N rows must not fetch per row.
 *
 * The hero board drew its "Spread · 30d" sparkline with a per-row hook that
 * paged up to 10 windows of 5000 one-minute buckets PER ASSET, then threw the
 * result away down to 48 points. One homepage load made 68 API requests, 65 of
 * them `/history?limit=5000`, against a 300/min per-IP limit. Nothing failed
 * loudly: past the limit the cell just renders "-".
 *
 * `tests/public/page-contract.spec.ts` measures the real request count against
 * production. This is the cheap always-on half that runs in `bun run test` and
 * needs no network.
 */
describe("row-rendering surfaces do not fetch per row", () => {
  it("the hero board reads the inline series_24h, not a per-asset history hook", () => {
    const hero = readCode("components/organisms/v2/hero-v2.tsx");

    // The specific hooks that page /v1/assets/:symbol/history. Importing
    // either from a component that renders a LIST reintroduces the storm.
    expect(hero).not.toMatch(/from\s+"@\/lib\/hooks\/use-history-30d"/);
    expect(hero).not.toMatch(/from\s+"@\/lib\/hooks\/use-asset-sparkline"/);

    // And it must actually be using the inline series carried on the row.
    expect(hero).toContain("row.spark");
  });

  it("selectBoardRows carries series_24h onto the row", () => {
    const shared = readCode("components/organisms/v2/shared.tsx");
    expect(shared).toContain("series_24h");
    expect(shared).toMatch(/spark\?:\s*number\[\]/);
  });

  it("the 30d history hook is only used by single-asset surfaces", () => {
    // useHistory30d itself is fine — the asset-detail 30-day strip is ONE
    // asset on ONE page. The rule is that no list/board surface may use it.
    const strip = readCode("components/molecules/state-strip-30d.tsx");
    expect(strip).toContain("useHistory30d");

    for (const rel of [
      "components/organisms/v2/hero-v2.tsx",
      "components/organisms/dashboard-board-row.tsx",
      "components/organisms/assets-screener-row.tsx",
    ]) {
      expect(readCode(rel), `${rel} must not fetch history per row`).not.toContain(
        "useHistory30d",
      );
    }
  });
});

describe("/dashboard has a page heading", () => {
  it("renders an <h1> outside the hover card", () => {
    // The route's only <h1> used to live in DashboardVerdict, which the
    // 2026-07-14 rebuild moved inside a Radix HoverCard. Radix does not mount
    // hover-card content until it opens, so the heading was absent on load,
    // not merely hidden. axe's `page-has-heading-one` is tagged best-practice
    // and the a11y suite scopes to wcag2a/2aa, so it covered the page without
    // being able to see this.
    const page = readCode("app/(app)/dashboard/page.tsx");
    expect(page).toMatch(/<h1[\s>]/);

    // And the hover-card copy must not claim h1 any more, or the page would
    // have two once opened.
    const verdict = readCode("components/organisms/dashboard-verdict.tsx");
    expect(verdict).not.toMatch(/<h1[\s>]/);
    expect(verdict).toMatch(/<h2[\s>]/);
  });
});
