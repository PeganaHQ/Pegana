import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

// W2 (2026-07-03): the `.tl` vertical timeline — methodology changelog and
// /changelog releases both reduce to "a spine of dated items, the newest
// optionally lit up as the active/hot entry".

export function TimelineV2({ children }: { children: ReactNode }) {
  return <div className="v2-in-tl">{children}</div>;
}

export function TimelineItemV2({
  hot,
  meta,
  title,
  children,
}: {
  /** Lights the spine dot (peg green) — reserved for the current/active entry. */
  hot?: boolean;
  meta: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={cn("v2-in-tlitem", hot && "v2-in-hot")}>
      <div className="v2-in-tlmeta">{meta}</div>
      {title && <h3>{title}</h3>}
      {children}
    </div>
  );
}

/** Small colored border+text pill used inside `.v2-in-tlmeta` rows (Active /
 *  Deprecated / Feature / Fix / Internal). Plain inline style since the
 *  color is data-driven (state token), not a fixed Tailwind class. */
export function TypePillV2({
  color,
  children,
}: {
  color: string;
  children: ReactNode;
}) {
  return (
    <span
      className="v2-in-typepill"
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 38%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}
