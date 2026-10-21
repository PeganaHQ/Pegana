"use client";

import Link from "@/components/atoms/intent-link";
import { cn } from "@/lib/utils/cn";
import { IconArrowRight } from "@/components/atoms/icon-arrow-right";
import { cardSurface } from "@/components/atoms/surface-card";
import type { AssetCardData } from "@/lib/api/types";

interface Props {
  asset: AssetCardData;
  className?: string;
}

// Bottom-of-page action strip. The /asset/[X] read leaves the user with one
// of three intents: compare against peers, verify on-chain, or actually
// trade. Surface all three as a single row so the page doesn't end on
// "here's a mint address you can copy" and nothing else.
export function AssetActionStrip({ asset, className }: Props) {
  // jup.ag DEPRECATED the `/swap/<inputMint>-<outputMint>` PATH form: it now
  // silently drops the output mint and defaults Buy to SOL (verified live
  // 2026-07-24 — `/swap/USDC-hyUSD` opened as Sell USDC → Buy SOL, losing the
  // asset). The query-param form `?sell=&buy=` is the current one that actually
  // pre-fills the route. Build it from MINTS: asset.mint is the output; the
  // input is SOL for SOL-pegged assets and USDC otherwise — but SOL when the
  // asset itself IS USDC, so we never emit a USDC→USDC self-swap.
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const inputMint =
    asset.peg_target === "SOL" || asset.mint === USDC_MINT
      ? SOL_MINT
      : USDC_MINT;
  const jupiterUrl = `https://jup.ag/swap?sell=${inputMint}&buy=${asset.mint}`;

  return (
    <section
      className={cn(
        "border-t border-hairline px-5 py-10 sm:px-8 sm:py-12",
        className,
      )}
    >
      <header className="mb-6 flex items-baseline justify-between gap-3">
        <h2 className="text-[22px] font-medium leading-[1.15] tracking-[-0.02em] sm:text-[26px]">
          Take it further
        </h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
          External links open in a new tab
        </span>
      </header>

      <ul className="grid gap-2.5 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
        <ActionCard
          kicker="Compare"
          title="Stack against peers"
          body={`Overlay ${asset.symbol} with up to three other ${classGroup(asset.class)} on the spread chart.`}
          href={`/compare?s=${encodeURIComponent(asset.symbol)}`}
        />
        <ActionCard
          kicker="Trade"
          title="Open in Jupiter"
          body="Pre-filled route. Pegana doesn't model fees or slippage. Verify the quote on Jupiter before sending."
          href={jupiterUrl}
          external
        />
        <ActionCard
          kicker="Verify"
          title="Inspect on Solscan"
          body="Mint owner, holders, recent transactions. The on-chain ground truth Pegana derives from."
          href={`https://solscan.io/token/${asset.mint}`}
          external
        />
        <ActionCard
          kicker="Live"
          title="Follow flips as they happen"
          body="Every state transition, streamed with the receipt attached. Or hold the WebSocket open yourself."
          href="/events"
          primary
        />
      </ul>
    </section>
  );
}

function ActionCard({
  kicker,
  title,
  body,
  href,
  external,
  primary,
}: {
  kicker: string;
  title: string;
  body: string;
  href: string;
  external?: boolean;
  primary?: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        className={cn(
          cardSurface({
            radius: 16,
            className: "group flex h-full flex-col gap-3 p-4",
          }),
          // The primary action (Follow flips) carries a subtle, INTENTIONAL V5
          // emphasis — a brighter hairline (border-outline), not the old
          // inconsistent one-off border. Everything else stays uniform.
          primary ? "border-outline" : "border-hairline",
        )}
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
          {kicker}
        </div>
        <div className="text-[15px] font-medium leading-snug tracking-[-0.01em] sm:text-[16px]">
          {title}
        </div>
        <p className="text-[12px] leading-relaxed text-text-muted">{body}</p>
        <span className="mt-auto inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted transition-colors duration-300 group-hover:text-text">
          {external ? "Open" : "Go"}
          <IconArrowRight
            size={10}
            className="transition-transform duration-500 group-hover:translate-x-1"
          />
        </span>
      </Link>
    </li>
  );
}

function classGroup(c: string): string {
  if (c === "lst") return "LSTs";
  if (c.startsWith("stable_")) return "stables";
  if (c === "synth_lev") return "leveraged synths";
  return "assets";
}
