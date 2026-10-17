import type { ReactNode } from "react";

// W2 (2026-07-03): "What this is not" — a struck-through claim paired with
// the honest reframe. Static editorial copy (candor is a stance, not data),
// same three lines the product has stated since Trust-Layer v0.1.0.

export interface CandorRow {
  no: string;
  yes: ReactNode;
}

export function CandorStrikesV2({ rows }: { rows: CandorRow[] }) {
  return (
    <div className="v2-in-candor">
      {rows.map((r) => (
        <div key={r.no} className="v2-in-candor-row">
          <span className="v2-in-candor-no">{r.no}</span>
          <span className="v2-in-candor-yes">{r.yes}</span>
        </div>
      ))}
    </div>
  );
}
