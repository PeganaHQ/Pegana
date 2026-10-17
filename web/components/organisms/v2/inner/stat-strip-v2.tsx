import type { ReactNode } from "react";

// W2 (2026-07-03): the `.stats` strip (audit ledger totals, /status alert
// activity). Callers build the `items` array themselves and simply omit a
// cell when they don't have a real number for it — no placeholder/sample
// values get fabricated here.

export interface StatItem {
  value: ReactNode;
  label: string;
  /** CSS color for the value, e.g. a state token — defaults to --v2-text. */
  color?: string;
}

export function StatStripV2({ items }: { items: StatItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="v2-in-stats">
      {items.map((it, i) => (
        <div key={i} className="v2-in-stat">
          <b style={it.color ? { color: it.color } : undefined}>{it.value}</b>
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  );
}
