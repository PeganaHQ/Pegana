import type { ReactNode } from "react";

// W2 (2026-07-03): the `.inc` incident/post-mortem card for /status. Bound to
// the real RELIABILITY_LOG entries (lib/reliability/incidents.ts) — every
// field here is real copy from that log, not artifact sample text.

export function IncidentCardV2({
  meta,
  title,
  children,
  commits,
}: {
  meta: ReactNode;
  title: string;
  children: ReactNode;
  commits: string[];
}) {
  return (
    <div className="v2-in-inc">
      <div className="v2-in-tlmeta">{meta}</div>
      <h3>{title}</h3>
      <div className="v2-in-prose">{children}</div>
      {commits.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] text-[var(--v2-dim)]">
            shipped in
          </span>
          {commits.map((c) => (
            <span key={c} className="v2-in-hashchip">
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
