import type { ReactNode } from "react";
import { TokenIcon } from "@/components/atoms/token-icon";
import type { AssetClass } from "@/lib/api/types";
import { cn } from "@/lib/utils/cn";
import { displaySymbol } from "@/lib/asset/display-symbol";

// W2 (2026-07-03): the `.receipt` object — /audit/[id]'s frozen-computation
// artifact. Dashed hairlines, tokico + symbol header, k/v rows, a replay
// footer. Every field is passed in by the page from the real /v1/audit/:id
// response (AuditReadyResponse) — this component only lays it out.

export interface ReceiptRow {
  k: string;
  v: ReactNode;
}

export function ReceiptObjectV2({
  iconLabel,
  mint,
  klass,
  symbol,
  subLabel,
  transition,
  rows,
  replayLine,
  className,
}: {
  iconLabel: string;
  mint?: string;
  klass?: AssetClass;
  symbol: string;
  subLabel?: ReactNode;
  /** From -> To state pills, already rendered (StatePillV2 x2 + arrow). */
  transition: ReactNode;
  rows: ReceiptRow[];
  /** Footer line, e.g. `$ pegana-replay --alert-id <id>` + a verified badge. */
  replayLine?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("v2-in-receipt v2-shadow-receipt", className)}>
      <div className="v2-in-rhead">
        <span className="v2-in-rwho">
          {mint ? (
            <TokenIcon
              mint={mint}
              symbol={displaySymbol(symbol)}
              klass={klass}
              size={22}
              className="v2-in-tokenicon"
            />
          ) : (
            <span className="v2-in-tokico">{iconLabel}</span>
          )}
          {displaySymbol(symbol)}
          {subLabel && (
            <span className="font-mono text-[11px] text-[var(--v2-muted)]">
              {subLabel}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">{transition}</span>
      </div>
      <div className="v2-in-rbody">
        {rows.map((r) => (
          <div key={r.k} className="v2-in-rrow">
            <span className="v2-in-rk">{r.k}</span>
            <span className="v2-in-rv">{r.v}</span>
          </div>
        ))}
      </div>
      {replayLine && <div className="v2-in-rfoot">{replayLine}</div>}
    </div>
  );
}
