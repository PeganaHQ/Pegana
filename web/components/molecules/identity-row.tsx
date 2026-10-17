"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { ExportButtons } from "@/components/molecules/export-buttons";
import { IconArrowUpRight } from "@/components/atoms/icon-arrow-right";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AssetCardData } from "@/lib/api/types";

interface IdentityRowProps {
  asset: AssetCardData;
  className?: string;
}

function truncate(addr: string): string {
  if (!addr) return "-";
  if (addr.length <= 18) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const klassLabel: Record<string, string> = {
  lst: "Liquid Staking Token",
  stable_fiat: "Fiat-backed stablecoin",
  stable_cdp: "CDP-backed stablecoin",
  stable_dn: "Delta-neutral stablecoin",
  stable_rwa: "RWA-backed stablecoin",
  stable_fx: "FX-pegged stablecoin",
  stable_yield: "Yield-bearing stablecoin",
  synth_lev: "Leveraged synthetic",
};

// Section with the same heading rhythm as Mechanism and Safety. Mint + actions
// are the focal row; secondary metadata sits as a small key-value grid.
export function IdentityRow({ asset, className }: IdentityRowProps) {
  const [copied, setCopied] = useState(false);

  async function copyMint() {
    if (!asset.mint || typeof navigator === "undefined" || !navigator.clipboard)
      return;
    try {
      await navigator.clipboard.writeText(asset.mint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard can fail under HTTP / older browsers — silent.
    }
  }

  return (
    <section
      className={cn(
        "rounded-[20px] border border-hairline bg-surface-1 p-5 sm:p-6",
        className,
      )}
    >
      <header className="mb-7 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[22px] font-medium leading-[1.15] tracking-[-0.02em] sm:text-[26px]">
          Identity
        </h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
          On Solana mainnet
        </span>
      </header>

      <div className="flex flex-wrap items-baseline gap-3 font-mono text-[13px]">
        <Tooltip>
          <TooltipTrigger asChild>
            <code
              // The full mint address exists ONLY in this tooltip — a
              // non-focusable <code> made it mouse-only. tabIndex + the full
              // value as the accessible name.
              tabIndex={0}
              aria-label={`Mint address ${asset.mint}`}
              className="cursor-help text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text"
            >
              {truncate(asset.mint)}
            </code>
          </TooltipTrigger>
          <TooltipContent>{asset.mint}</TooltipContent>
        </Tooltip>
        <button
          type="button"
          onClick={copyMint}
          className="border border-hairline px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-muted transition-colors hover:border-outline hover:text-text"
          aria-label="Copy mint address"
        >
          {copied ? "copied" : "copy"}
        </button>
        <a
          href={`https://solscan.io/token/${asset.mint}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 border border-hairline px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text-muted transition-colors hover:border-outline hover:text-text"
        >
          Solscan <IconArrowUpRight size={9} />
        </a>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-[12px] sm:grid-cols-4">
        <Term k="Class">{klassLabel[asset.class] ?? asset.class}</Term>
        <Term k="Decimals">{asset.decimals}</Term>
        <Term k="Peg target">{asset.peg_target}</Term>
        <Term k="Last updated">
          {asset.updated_at
            ? new Date(asset.updated_at).toLocaleString("en", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "UTC",
              })
            : "-"}
        </Term>
      </dl>

      <ExportButtons symbol={asset.symbol} className="mt-6" />
    </section>
  );
}

function Term({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-text-muted uppercase tracking-[0.08em] text-[10px]">
        {k}
      </dt>
      <dd className="mt-1 text-text">{children}</dd>
    </div>
  );
}
