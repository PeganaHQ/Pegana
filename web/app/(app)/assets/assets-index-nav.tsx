import Link from "@/components/atoms/intent-link";
import type { ServerAsset } from "@/lib/asset/fetch-asset";
import { displaySymbol } from "@/lib/asset/display-symbol";

/**
 * Server-rendered index of every tracked asset.
 *
 * WHY. `/assets` is the page whose name promises all 68 assets and which carries
 * sitemap priority 0.9 — and it server-rendered **zero** `<a href="/asset/…">`
 * links, because the screener is a client component that CSR-bails on
 * `useSearchParams()`.
 *
 * ⚠️ CORRECTED 2026-07-31 — the original version of this comment blamed a CSR
 * bailout from `useSearchParams()` inside `<Suspense fallback={null}>`. That is
 * NOT what happens on this site. The root layout is `async` and calls
 * `headers()`, which makes every route dynamically rendered — and per Next's own
 * docs, "if a route is dynamically rendered, useSearchParams will be available
 * on the server during the initial server render". Live response headers confirm
 * it (`cache-control: no-store`). There is no bailout.
 *
 * The real cause is simpler: SWR has no data on the server, so `useAsset()`
 * returns `isLoading: true` and the client component renders its six-row
 * skeleton branch. THAT is the 28 words. This file fixes it the same way either
 * way — by rendering real content from a server fetch — but the distinction
 * matters, because chasing the Suspense boundary would change nothing. Result: every stablecoin and yield-bearing token had no
 * server-rendered inbound link anywhere on the site (`/lst` links only LSTs), so
 * the 68 detail pages were reachable by crawl only via the sitemap itself. For
 * comparison `/lst` server-renders 41 such links and 3,036 words.
 *
 * WHY THIS IS A <nav>, NOT A SECOND <table>. web/AGENTS.md requires every
 * surface rendering *rows of data* to be a real `<table>` — and the screener
 * above already is one. This is not that surface: it carries no measurements,
 * only names and destinations. A jump-list of links is navigation, and
 * `<nav>/<ul>/<a>` is the honest element for it. Duplicating 68 rows of live
 * data into a second table would both violate the spirit of that rule and put
 * two competing sources of the same numbers on one page.
 *
 * It renders OUTSIDE the screener's Suspense boundary, so it survives the CSR
 * bailout, and it carries no live numbers — nothing here can drift from the
 * client table above it or produce a hydration mismatch.
 */

const CLASS_LABELS: Record<string, string> = {
  lst: "Liquid staking tokens",
  stable_fiat: "Fiat-backed stablecoins",
  stable_dn: "Delta-neutral synthetic dollars",
  stable_cdp: "CDP-backed stablecoins",
  stable_yield: "Yield-bearing stables",
  stable_fx: "FX-referenced stablecoins",
  synth_lev: "Leveraged synthetics",
};

export function AssetsIndexNav({ assets }: { assets: ServerAsset[] }) {
  if (assets.length === 0) return null;

  const groups = new Map<string, ServerAsset[]>();
  for (const a of assets) {
    const key = a.class ?? "other";
    const bucket = groups.get(key);
    if (bucket) bucket.push(a);
    else groups.set(key, [a]);
  }
  // Stable, deterministic ordering — largest class first, then alphabetical by
  // label, so server and client agree and the markup doesn't churn per build.
  const ordered = [...groups.entries()].sort(
    (x, y) =>
      y[1].length - x[1].length ||
      (CLASS_LABELS[x[0]] ?? x[0]).localeCompare(CLASS_LABELS[y[0]] ?? y[0]),
  );

  return (
    <nav
      aria-labelledby="assets-index-heading"
      className="mx-auto max-w-[1440px] border-t border-hairline px-5 py-12 sm:px-6"
    >
      <h2
        id="assets-index-heading"
        className="text-[19px] font-medium tracking-[-0.01em] text-text"
      >
        All {assets.length} tracked assets
      </h2>
      <p className="mt-2 max-w-[68ch] text-[14.5px] leading-[1.6] text-text-muted">
        Every asset Pegana monitors, grouped by peg mechanism. Each links to its
        live peg state, spread history and verifiable receipts.
      </p>

      <div className="mt-7 grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {ordered.map(([klass, items]) => (
          <div key={klass}>
            <h3 className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-text-muted">
              {CLASS_LABELS[klass] ?? klass}
            </h3>
            <ul className="mt-2.5 flex flex-col gap-1.5">
              {items
                .slice()
                .sort((a, b) => a.symbol.localeCompare(b.symbol))
                .map((a) => (
                  <li key={a.symbol}>
                    <Link
                      href={`/asset/${encodeURIComponent(a.symbol)}`}
                      className="text-[14px] text-text-muted underline decoration-transparent underline-offset-2 transition-colors hover:text-text hover:decoration-current"
                    >
                      <span className="font-medium">
                        {displaySymbol(a.symbol)}
                      </span>
                      {a.name ? (
                        <span className="text-text-caption"> · {a.name}</span>
                      ) : null}
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
