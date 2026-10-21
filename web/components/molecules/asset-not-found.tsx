"use client";

import Link from "@/components/atoms/intent-link";
import { useMemo } from "react";
import { IconArrowRight } from "@/components/atoms/icon-arrow-right";
import { useAssets } from "@/lib/hooks/use-assets";
import { displaySymbol } from "@/lib/asset/display-symbol";

interface AssetNotFoundProps {
  symbol: string;
  /** When true, the upstream fetch failed network-side rather than with a 404. */
  apiUnreachable?: boolean;
  /**
   * The API answered 429: this browser's IP used up its public 60/min budget.
   * The API is healthy, so this is worded as a pause, never as an outage.
   * Takes precedence over `apiUnreachable`.
   */
  rateLimited?: boolean;
  /** Seconds from Retry-After, when the API sent one. */
  retryAfterSec?: number;
}

export function AssetNotFound({
  symbol,
  apiUnreachable: apiUnreachableProp = false,
  rateLimited = false,
  retryAfterSec,
}: AssetNotFoundProps) {
  // A rate-limited visitor gets neither the outage copy nor the 404 copy.
  const apiUnreachable = apiUnreachableProp || rateLimited;
  const { data: assets } = useAssets();

  // For ~22 assets a case-insensitive substring match is plenty. Avoids
  // pulling a fuzzy-match dependency or hand-rolled edit distance.
  const suggestions = useMemo(() => {
    if (apiUnreachable || !assets) return [];
    const q = symbol.toLowerCase();
    return assets
      .filter(
        (a) =>
          // Never suggest the symbol that just 404'd (e.g. xSOL, a leveraged
          // synth off the public surface) or another synth_lev.
          a.class !== "synth_lev" &&
          a.symbol.toLowerCase() !== q &&
          (a.symbol.toLowerCase().includes(q) ||
            q.includes(a.symbol.toLowerCase())),
      )
      .slice(0, 3);
  }, [assets, symbol, apiUnreachable]);

  return (
    <section className="mx-auto max-w-[1280px] px-5 py-16 sm:px-8 sm:py-24">
      <div className="grid items-baseline gap-4 md:grid-cols-[110px_1fr] md:gap-16">
        <span className="inline-flex w-fit rounded-full border border-hairline px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-text-caption">
          {rateLimited ? "429 · paused" : apiUnreachable ? "503 · feed" : "404"}
        </span>
        <div className="max-w-[720px]">
          <h1 className="text-[40px] font-medium leading-[1.05] tracking-[-0.035em] sm:text-[56px]">
            {rateLimited ? (
              "Too many requests from this network."
            ) : apiUnreachable ? (
              "Live feed unreachable."
            ) : (
              <>
                No asset matches <span className="font-mono">{symbol}</span>.
              </>
            )}
          </h1>
          <p className="mt-5 max-w-[560px] text-[15px] leading-snug text-text-muted sm:text-[17px]">
            {rateLimited
              ? `The Pegana API is up, but it allows 60 requests a minute per IP and this network has used them. The page retries on its own${
                  typeof retryAfterSec === "number" && retryAfterSec > 0
                    ? ` in about ${retryAfterSec}s`
                    : " within a minute"
                }.`
              : apiUnreachable
              ? "The Pegana API isn't responding right now. The live dashboard and per-asset detail will come back automatically as soon as it's healthy."
              : "Pegana tracks a fixed list of Solana LSTs, stables and synthetics. The full universe lives on the dashboard."}
          </p>

          {!apiUnreachable && suggestions.length > 0 && (
            <div className="mt-10">
              <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-muted">
                Did you mean
              </div>
              <ul className="mt-3 flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <li key={s.symbol}>
                    <Link
                      href={`/asset/${encodeURIComponent(s.symbol)}`}
                      className="group inline-flex items-baseline gap-2 rounded-full border border-hairline px-3.5 py-2 text-[14px] transition-colors duration-300 hover:border-outline"
                    >
                      <span className="font-medium">
                        {displaySymbol(s.symbol)}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted">
                        {s.name}
                      </span>
                      <IconArrowRight
                        size={11}
                        className="text-text-muted transition-transform duration-500 group-hover:translate-x-1"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-10 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="group inline-flex items-center gap-2 rounded-full bg-text px-4 py-3 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-canvas transition-colors duration-300 hover:bg-text/85"
            >
              Open dashboard
              <IconArrowRight
                size={11}
                className="transition-transform duration-500 group-hover:translate-x-1"
              />
            </Link>
            <Link
              href="/status"
              className="group inline-flex items-center gap-2 rounded-full border border-outline px-4 py-3 font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted transition-colors duration-300 hover:border-text hover:text-text"
            >
              {apiUnreachable ? "Check status" : "Browse universe"}
              <IconArrowRight
                size={11}
                className="transition-transform duration-500 group-hover:translate-x-1"
              />
            </Link>
            {/* A real 404 (untracked token) is a dead-end otherwise — give the
                visitor a way to ask for coverage. Email is the only contact
                channel now that the Telegram bot is gone. Never shown for a
                503 (feed down), where the problem is us, not the asset. */}
            {!apiUnreachable && (
              <a
                href={`mailto:rafael@pegana.xyz?subject=${encodeURIComponent(
                  `Coverage request: ${symbol}`,
                )}`}
                className="group inline-flex items-center gap-2 rounded-full border border-hairline px-4 py-3 font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted transition-colors duration-300 hover:border-text hover:text-text"
              >
                Request coverage for {symbol}
                <IconArrowRight
                  size={11}
                  className="transition-transform duration-500 group-hover:translate-x-1"
                />
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
