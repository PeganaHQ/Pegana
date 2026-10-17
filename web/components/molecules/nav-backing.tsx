"use client";

import type { AssetCardData } from "@/lib/api/types";
import { formatUsdValue } from "@/lib/api/format";
import { HelpIcon } from "@/components/atoms/help-icon";

// NAV / Proof-of-Reserves decomposition for LSTs. Turns the opaque intrinsic_usd
// into the auditable engine formula: intrinsic = sol_per_lst (on-chain stake-pool
// SOL/share, Sanctum sol_value) × SOL/USD. The SOL/USD multiplier is the one that
// PRODUCED this intrinsic, recovered client-side WITHOUT scraping Pyth (both
// numbers are already on the response) — labeled "implied" since it can be a
// cross-cycle ratio (review MED-2). Renders only for LSTs with both factors.

const STALE_MS = 10 * 60 * 1000;

function relAge(updatedAt: string | null | undefined): {
  fresh: boolean;
  label: string;
} {
  if (!updatedAt) return { fresh: false, label: "-" };
  const ms = Date.now() - new Date(updatedAt).getTime();
  const fresh = ms < STALE_MS;
  const label =
    ms < 60_000
      ? "just now"
      : ms < 3_600_000
        ? `${Math.round(ms / 60_000)}m ago`
        : `${Math.round(ms / 3_600_000)}h ago`;
  return { fresh, label };
}

export function NavBacking({ asset }: { asset: AssetCardData }) {
  if (asset.class !== "lst" || !asset.sol_per_lst || !asset.intrinsic_usd)
    return null;
  const solPerLst = parseFloat(asset.sol_per_lst);
  const intrinsic = parseFloat(asset.intrinsic_usd);
  if (
    !Number.isFinite(solPerLst) ||
    solPerLst <= 0 ||
    !Number.isFinite(intrinsic)
  )
    return null;

  const impliedSolUsd = intrinsic / solPerLst;
  const { fresh, label } = relAge(asset.updated_at);

  return (
    <div>
      <h2 className="flex items-center text-[28px] font-medium leading-[1.1] tracking-[-0.01em] text-text">
        Backing · proof of reserves
        <HelpIcon term="intrinsic" side="bottom" />
      </h2>
      <p className="mb-4 mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-caption">
        On-chain stake-pool value (Sanctum sol_value), the engine&rsquo;s
        intrinsic source
      </p>

      <div className="rounded-[20px] border border-hairline bg-surface-1 p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
          <Factor
            label="Stake pool"
            value={`${solPerLst.toFixed(4)}`}
            unit="SOL / share"
          />
          <Op>×</Op>
          <Factor
            label="SOL / USD"
            value={formatUsdValue(String(impliedSolUsd))}
            unit="implied"
          />
          <Op>=</Op>
          <Factor
            label="Intrinsic"
            value={formatUsdValue(asset.intrinsic_usd)}
            unit="per token"
            accent
          />
        </div>

        <div className="border-t border-hairline pt-5 mt-5">
          <dl className="grid gap-2 font-mono text-[10px] sm:grid-cols-3">
            <BackingRow label="NAV source" value="Sanctum sol_value" />
            <BackingRow label="Reserve mix" value="Stake-pool SOL reserves" />
            <BackingRow
              label="Unit basis"
              value="SOL/share × implied SOL/USD"
            />
          </dl>
        </div>
      </div>

      <p className="mt-2.5 font-mono text-[10px] tracking-[0.04em] text-text-caption">
        {fresh ? (
          <>
            Snapshot {label} · SOL/USD is implied from the same intrinsic sample
          </>
        ) : (
          <span className="text-st-drift">
            Snapshot stale ({label}); backing may be out of date
          </span>
        )}
      </p>
    </div>
  );
}

function BackingRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="uppercase tracking-[0.12em] text-text-caption">{label}</dt>
      <dd className="mt-1 text-text-body">{value}</dd>
    </div>
  );
}

function Factor({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit: string;
  accent?: boolean;
}) {
  return (
    <div className="flex-1">
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-caption">
        {label}
      </div>
      <div
        className={`mt-1 font-mono text-[22px] font-medium tabular-nums leading-none ${accent ? "text-text" : "text-text-body"}`}
      >
        {value}
      </div>
      <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.08em] text-text-caption">
        {unit}
      </div>
    </div>
  );
}

function Op({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="hidden shrink-0 pb-5 font-mono text-[18px] text-text-caption sm:block"
      aria-hidden
    >
      {children}
    </div>
  );
}
