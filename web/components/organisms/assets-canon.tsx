"use client";

import { useId, useState } from "react";
import { TokenIcon } from "@/components/atoms/token-icon";
import { assetClassForIcon } from "@/lib/asset/canon";
import {
  ListRowsV2,
  ListRowHead,
  ListRow,
} from "@/components/organisms/v2/inner/list-rows-v2";

// Collapsible canonical-asset roster (V5 W2, 2026-07-03 — re-skinned onto
// the shared list-rows pattern; same data/logic as before, just no longer a
// bordered <table>). Leads with a class summary + the first rows, then
// discloses the rest — the raw 22+-row table was the page's density problem.

export interface CanonAsset {
  symbol: string;
  name?: string;
  mint?: string;
  className: string;
  pegTarget: string;
  verified: boolean;
}

const CLASS_LABEL: Record<string, string> = {
  lst: "LST",
  stable_fiat: "Stablecoin",
  stable_cdp: "Stable · CDP",
  stable_rwa: "Stable · RWA",
  stable_dn: "Stable · DN",
  stable_fx: "Stable · FX",
  stable_yield: "Stable · Yield",
  synth_lev: "Synth · Leverage",
};

const PREVIEW = 8;
const COLUMNS = "1.35fr .72fr .62fr .7fr";

function iconForAsset(asset: CanonAsset) {
  if (!asset.mint) {
    return <span className="v2-in-tokico">{asset.symbol.slice(0, 2)}</span>;
  }
  return (
    <TokenIcon
      mint={asset.mint}
      symbol={asset.symbol}
      klass={assetClassForIcon(asset.className)}
      size={22}
      className="v2-in-tokenicon"
    />
  );
}

export function AssetsCanon({ assets }: { assets: CanonAsset[] }) {
  const listId = useId();
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? assets : assets.slice(0, PREVIEW);

  // class → count, ordered by frequency
  const counts = new Map<string, number>();
  for (const a of assets)
    counts.set(a.className, (counts.get(a.className) ?? 0) + 1);
  const classChips = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div>
      <p className="font-mono text-[13px] text-[var(--v2-muted)]">
        <span className="text-[var(--v2-text)]">{assets.length}</span> active
        assets across{" "}
        <span className="text-[var(--v2-text)]">{classChips.length}</span>{" "}
        classes
      </p>
      <div
        className="v2-in-chips"
        style={{ justifyContent: "flex-start", margin: "12px 0 0" }}
      >
        {classChips.map(([cls, n]) => (
          <span key={cls} className="v2-in-chip">
            {CLASS_LABEL[cls] ?? cls} <b>{n}</b>
          </span>
        ))}
      </div>

      <div id={listId}>
        <ListRowsV2 label="Canonical tracked assets" wide minWidth={700}>
          <ListRowHead columns={COLUMNS}>
            <span>Symbol</span>
            <span>Class</span>
            <span>Peg target</span>
            <span>Verified</span>
          </ListRowHead>
          {rows.map((a) => (
            <ListRow
              key={a.symbol}
              columns={COLUMNS}
              href={`/asset/${encodeURIComponent(a.symbol)}`}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                {iconForAsset(a)}
                <span className="flex min-w-0 flex-col">
                  <b className="truncate text-[13.5px] font-medium">
                    {a.symbol}
                  </b>
                  <span className="truncate text-[12px] text-[var(--v2-muted)]">
                    {a.name ?? a.symbol}
                  </span>
                </span>
              </span>
              <span className="inline-flex w-fit items-center rounded-full border border-[var(--v2-line2)] px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-[var(--v2-muted)]">
                {CLASS_LABEL[a.className] ?? a.className}
              </span>
              <span className="font-mono text-[12.5px]">{a.pegTarget}</span>
              <span
                className="font-mono text-[11.5px]"
                style={{
                  color: a.verified ? "var(--v2-peg)" : "var(--v2-dim)",
                }}
              >
                <span aria-hidden>&#9679;</span>{" "}
                {a.verified ? "on-chain" : "pending"}
              </span>
            </ListRow>
          ))}
        </ListRowsV2>
      </div>

      {assets.length > PREVIEW && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          aria-controls={listId}
          className="mt-4 font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--v2-muted)] transition-colors duration-200 hover:text-[var(--v2-text)]"
        >
          {showAll ? "Show less" : `Show all ${assets.length}`}
        </button>
      )}
    </div>
  );
}
