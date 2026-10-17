import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..", "..");

/**
 * A server-side fetch that fails must not look like a fetch that succeeded and
 * found nothing.
 *
 * `/lst` shipped that exact confusion. `fetchPeganaLstAssets` degraded to `[]`
 * on any failure — deliberately, so the page would render instead of 500 — but
 * an empty verdict overlay made every row `covered: false`, which the table
 * renders as "not yet covered": a permanent claim about what this product
 * tracks. The header counted "0 Covered by Pegana" beside it. During a
 * sixty-second outage of our own API, a visitor saw a complete directory of
 * Solana LSTs asserting Pegana covers none of them.
 *
 * Browser-level QA cannot catch this. These fetches run on the server, so
 * intercepting network in Playwright blocks nothing — I confirmed that the hard
 * way, measuring zero blocked calls and concluding the bug did not exist. The
 * only place it is visible is the source.
 *
 * So the rule is a source rule: a cached server fetch either reports WHY it has
 * no data, or its consumer must render nothing at all. Returning a bare `[]`
 * lets the caller silently mistake absence for evidence.
 */

const SERVER_FETCH_MARKER = "next: { revalidate";

/**
 * Fetchers allowed to return a bare empty/null, each because its consumer
 * renders NOTHING rather than a claim. Adding an entry means checking that.
 */
const RENDERS_NOTHING_ON_EMPTY: Record<string, string> = {
  "lib/asset/fetch-asset.ts":
    "getAssetsList -> assets-index-nav returns null at length 0; getAsset -> " +
    "page.tsx guards `{asset ? …}` so the SEO prose and JSON-LD never render " +
    "from absent data. Neither path states a fact.",
  "lib/github-commits.ts":
    "Changelog prose parser, not a data-plane read. No peg claim depends on it.",
};

function serverFetchers(): { rel: string; src: string }[] {
  const out: { rel: string; src: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.ts$/.test(entry)) continue;
      const src = readFileSync(full, "utf8");
      if (!src.includes(SERVER_FETCH_MARKER)) continue;
      out.push({ rel: full.slice(WEB_ROOT.length + 1), src });
    }
  };
  walk(join(WEB_ROOT, "lib"));
  return out;
}

describe("server-side fetches report failure, or their consumer renders nothing", () => {
  it("finds the server fetchers at all", () => {
    // Guards against the whole suite passing vacuously if the marker changes.
    expect(serverFetchers().length).toBeGreaterThanOrEqual(4);
  });

  it("every fetcher either reports a status or is allowlisted with a reason", () => {
    const offenders: string[] = [];
    for (const { rel, src } of serverFetchers()) {
      if (rel in RENDERS_NOTHING_ON_EMPTY) continue;
      // A discriminated result: `status: "error" | "unreachable" | …`, or an
      // explicit skip reason like tokens-xyz's `skip: "http_error"`.
      const reportsWhy = /status:\s*"|skip:\s*"/.test(src);
      if (!reportsWhy) {
        offenders.push(
          `${rel} returns no failure reason and is not allowlisted. Either give it a ` +
            `discriminated result, or add it to RENDERS_NOTHING_ON_EMPTY after ` +
            `checking its consumer renders nothing rather than a claim.`,
        );
      }
    }
    expect(offenders, offenders.join("\n\n")).toEqual([]);
  });

  it("the /lst overlay specifically still distinguishes no-answer from no-assets", () => {
    const src = readFileSync(
      join(WEB_ROOT, "lib", "lst", "fetch-pegana-lst.ts"),
      "utf8",
    );
    expect(src).toMatch(/status:\s*"error"/);
    expect(src).toMatch(/status:\s*"ok"/);
  });
});
