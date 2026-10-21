import Link from "@/components/atoms/intent-link";
import type { ServerAsset } from "@/lib/asset/fetch-asset";
import { displaySymbol } from "@/lib/asset/display-symbol";
import { holderSignedPct, formatUsdValue } from "@/lib/api/format";
import { stateMeta } from "@/lib/asset/state-meta";
import type { AssetCardData, PegState } from "@/lib/api/types";

/**
 * Server-rendered editorial for one asset.
 *
 * WHY IT EXISTS. Every /asset/[symbol] page shipped 60KB of HTML containing 28
 * words — nav chrome and the <title>, nothing else. Two causes: the page is one
 * client component whose data arrives from SWR (undefined on the server), and
 * it CSR-bails because `useSearchParams()` sits inside `<Suspense fallback={null}>`,
 * which drops that whole subtree from prerender.
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
 * matters, because chasing the Suspense boundary would change nothing.
 *
 * Google's second indexing wave might eventually render it. Essentially no LLM
 * retrieval crawler will — GPTBot, ClaudeBot, PerplexityBot and OAI-SearchBot
 * fetch raw HTML and do not execute JavaScript. So the 68 pages that answer
 * "is jitoSOL depegged?" — the exact question a buyer types into an LLM — were
 * blank to the systems answering it.
 *
 * DESIGN: this renders OUTSIDE the client component's Suspense boundary, so it
 * prerenders regardless of the bailout, and it deliberately does NOT duplicate
 * the live hero. It is real, visible, useful prose that happens to be the query
 * shape — not hidden text. Everything here is server-rendered from a single
 * cached fetch, with no relative timestamps and no client clock, so it cannot
 * produce a hydration mismatch against the live shell above it.
 *
 * SIGN CONVENTION: `discount` from the API is premium-NEGATIVE. Every number
 * below goes through `holderSignedPct`, never `bps/100` — printing it raw is
 * exactly the bug that made the editorial contradict the hero on all 68 pages.
 */

/** Human-readable UTC date: "Aug 6, 2026, 19:43 UTC". SSR-safe (explicit TZ). */
function formatUtcDate(iso: string): string {
  return (
    new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }).format(new Date(iso)) + " UTC"
  );
}

/**
 * Per-symbol mechanism copy for assets whose API class is a poor description.
 * JLP is served as `stable_yield` with a NAV anchor, but it is a perps LP
 * basket token trading in the dollars, not a yield stable expected above $1.
 */
const MECHANISM_OVERRIDES: Record<string, (sym: string) => string> = {
  JLP: (sym) =>
    `${sym} is the Jupiter Perpetuals liquidity-pool token. It has no $1 peg: each token is a share of the pool that backs perps traders, so its intrinsic value is the pool's NAV per token and Pegana measures it against that NAV.`,
};

/** Plain-English mechanism sentence, keyed off the asset's own class. */
export function mechanismSentence(
  sym: string,
  klass: string,
  apiSymbol?: string,
): string {
  const override = MECHANISM_OVERRIDES[apiSymbol ?? sym];
  if (override) return override(sym);
  switch (klass) {
    case "lst":
      return `${sym} is a Solana liquid staking token. It has no fixed $1 peg. Its intrinsic value is the underlying stake pool's SOL-per-share rate, so Pegana measures it against that NAV rather than against a dollar.`;
    case "stable_fiat":
      return `${sym} is a fiat-backed stablecoin, so its intrinsic value is $1.00 by construction and the only question is whether the market price is holding there.`;
    case "stable_dn":
      return `${sym} is a delta-neutral synthetic dollar. Its peg is maintained by a hedged basis position rather than a cash collateral pool, so a funding-regime shift is a distinct risk from a reserve shortfall.`;
    case "stable_cdp":
      return `${sym} is a CDP-backed stablecoin: it is minted against on-chain collateral, so Pegana reads the collateral ratio directly rather than inferring health from price alone.`;
    case "stable_yield":
      return `${sym} is a yield-bearing stable asset. It accrues value over time, so it is expected to trade above $1.00. A premium is the mechanism working, and a sustained discount is the signal that matters.`;
    case "synth_lev":
      return `${sym} is a leveraged synthetic with no peg at all. It trades at a premium or discount to NAV by design; a premium reflects leverage demand, and only a sustained discount indicates exit or redemption friction.`;
    case "stable_fx":
      return `${sym} is an FX-referenced stablecoin, so its intrinsic value tracks a non-USD currency rather than the dollar.`;
    default:
      return `Pegana derives ${sym}'s intrinsic value from its own peg mechanism and compares it against the best executable market quote.`;
  }
}

/** The direct answer to the literal query, with live numbers. */
export function verdictSentence(
  sym: string,
  state: string | null,
  gap: string,
  /** |raw spread| in bps and the asset's drift band, when both are known. */
  band?: { absBps: number; driftBps: number },
): string {
  switch (state) {
    case "PEGGED":
      // PEGGED outside the drift band happens on the side the methodology does
      // not score (e.g. a premium on a discount-side asset). Never claim "inside
      // its calibrated drift band" there: that was false, and indexed.
      if (band && band.absBps > band.driftBps) {
        return `Not by Pegana's classification: ${sym} is Pegged, though its latest read of ${gap} from intrinsic value sits outside its drift band. The state only changes once the smoothed spread confirms the move on the side its methodology scores.`;
      }
      return `No. ${sym} is holding its peg. Pegana's current read is ${gap} from intrinsic value, inside its calibrated drift band.`;
    case "DRIFT":
      return `Not yet, but it is drifting. ${sym} is currently ${gap} from intrinsic value. Outside its drift band but short of its depeg threshold.`;
    case "DEPEG":
      return `Yes. ${sym} is currently depegged, at ${gap} from intrinsic value, past its calibrated depeg threshold.`;
    case "CRITICAL":
      return `Yes, severely. ${sym} is ${gap} from intrinsic value, a deep and sustained break of its peg.`;
    case "BLACK_SWAN":
      return `Yes. ${sym} is in a black-swan dislocation at ${gap} from intrinsic value.`;
    case "UNKNOWN":
      return `Pegana cannot currently answer for ${sym}: one or more inputs are missing or failed a sanity check, so the state is reported as Unknown rather than guessed.`;
    case null:
      // No reading at all (no market quote and no intrinsic yet). The app
      // shows these as Unknown; the brief must not read as if it had a verdict.
      return `Pegana has no current reading for ${sym}: there is no live market quote and intrinsic value to compare yet, so the state is shown as Unknown rather than guessed.`;
    default:
      return `Pegana tracks ${sym}'s peg continuously and publishes a verifiable receipt for every state change.`;
  }
}

export function AssetSeoSection({ asset }: { asset: ServerAsset }) {
  const sym = displaySymbol(asset.symbol);
  const rawBps =
    asset.discount != null ? parseFloat(asset.discount) * 10_000 : null;
  const gap = holderSignedPct(
    Number.isFinite(rawBps as number) ? rawBps : null,
  );
  const state = asset.state;
  const driftBps = (asset as Partial<AssetCardData>).thresholds?.drift_bps;
  const band =
    rawBps != null && Number.isFinite(rawBps) && typeof driftBps === "number"
      ? { absBps: Math.abs(rawBps), driftBps }
      : undefined;

  return (
    <section
      aria-labelledby="asset-about-heading"
      className="mx-auto max-w-[1440px] px-5 sm:px-6"
    >
      <div className="mt-8 pb-20 sm:mt-10 sm:pb-24">
        <div className="mb-3">
          <span className="inline-flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-text-caption">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: stateMeta(state as PegState).dotVar }}
            />
            Peg Risk Brief
          </span>
        </div>

        <h2
          id="asset-about-heading"
          className="text-[22px] font-medium leading-[1.15] tracking-[-0.02em] text-text"
        >
          Is {sym} depegged?
        </h2>

        <p className="mt-2.5 max-w-[68ch] text-[14.5px] leading-[1.65] text-text-muted">
          {verdictSentence(sym, state, gap, band)}
          {/* The price sentence only when both sides exist: "last traded at -
              against an intrinsic value of -" is not a sentence a reader can
              use, and it is what EURC/JLP/USD* printed with no reading. */}
          {asset.market_usd != null && asset.intrinsic_usd != null ? (
            <>
              {" "}
              {asset.name ? `${asset.name} (${sym})` : sym} last traded at{" "}
              <strong className="text-text">
                {formatUsdValue(asset.market_usd)}
              </strong>{" "}
              against an intrinsic value of{" "}
              <strong className="text-text">
                {formatUsdValue(asset.intrinsic_usd)}
              </strong>
              {asset.updated_at ? (
                <>
                  , as of{" "}
                  <time dateTime={asset.updated_at}>
                    {formatUtcDate(asset.updated_at)}
                  </time>
                </>
              ) : null}
              .
            </>
          ) : null}
        </p>

        <p className="mt-4 max-w-[68ch] text-[14.5px] leading-[1.65] text-text-muted">
          {mechanismSentence(sym, asset.class, asset.symbol)} Pegana computes {sym}
          &rsquo;s intrinsic value from its peg mechanism and compares it against
          the best executable market quote. The spread is smoothed, classified
          against {sym}&rsquo;s own calibrated thresholds with hysteresis, and
          every state change emits a{" "}
          <Link
            href="/audit"
            className="underline decoration-dotted underline-offset-2 hover:text-text"
          >
            public receipt
          </Link>{" "}
          that anyone can re-derive byte-for-byte with the open-source{" "}
          <Link
            href="/methodology"
            className="underline decoration-dotted underline-offset-2 hover:text-text"
          >
            methodology crate
          </Link>
          .
        </p>

        {asset.updated_at && (
          <div className="mt-6 flex items-center gap-2 border-t border-hairline pt-4 font-mono text-[10px] uppercase tracking-[0.08em] text-text-caption">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: stateMeta(state as PegState).dotVar }}
            />
            Last verified {formatUtcDate(asset.updated_at)}
          </div>
        )}
      </div>
    </section>
  );
}
