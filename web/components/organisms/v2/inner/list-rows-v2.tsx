"use client";

import {
  Children,
  isValidElement,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";

// W2 (2026-07-03): the `.lrows` workhorse pattern — canon table, audit
// ledger, per-source uptime, commit feed all reduce to "hairline rows with a
// CSS-grid column template".
//
// Real-table pass (2026-07-14): this used to render plain `<div>`s laid out
// with an inline `gridTemplateColumns` — a fake table (rows of data with no
// <table>/<th>/<td> anywhere). Screen readers/AT got nothing table-shaped,
// and (in the audit ledger) a whole row was a single <a> with a <button>
// nested inside it — invalid HTML, interactive-in-interactive.
//
// Fix, deliberately scoped as bugs-only (NOT a re-skin — see brief): keep
// the exact CSS-grid layout system (same `gridTemplateColumns`/`gap`/
// `padding`/colors, same `--v2-*` tokens, zero visual change) but move it
// onto real table elements — `<tr style="display:grid">` overriding the
// default `table-row` box. This is a documented, deliberate technique (see
// Adrian Roselli's "grid as table" write-ups): CSS `display` can be
// overridden on a `<tr>`/`<td>`/`<th>` without changing the tag, but some
// browsers then drop the element's *implicit* ARIA role (the row/cell
// mapping is keyed off the box staying table-shaped) — so every row/cell
// below carries an explicit `role` to guarantee the table semantics survive
// regardless of the display override. `columns` (the raw `grid-template-
// columns` value, varies per usage) still passed straight through to each
// row's inline style, exactly as before; `ListRowsV2` additionally reads it
// (from its first head/row child, or an explicit `columns` prop for call
// sites — like the status page's `SourceRowV2` wrapper — where that child
// inspection can't reach the real column count) to emit a `<colgroup>` with
// the right number of `<col>`s (fixed-px tokens get a real width; `fr`
// tokens are left auto since layout is grid-driven, not table-driven).

type ColumnsProps = { columns?: string };

// Stable identity marker for cross-RSC-boundary head detection (see ListRowsV2).
const HEAD_DISPLAY_NAME = "ListRowHead";

function colgroupFromTemplate(template: string | undefined) {
  if (!template) return null;
  const tokens = template.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const FIXED = /^[\d.]+(px|%|rem|em|ch)$/;
  return (
    <colgroup>
      {tokens.map((t, i) => (
        <col key={i} style={FIXED.test(t) ? { width: t } : undefined} />
      ))}
    </colgroup>
  );
}

export function ListRowsV2({
  children,
  wide,
  minWidth,
  className,
  columns,
  label,
}: {
  children: ReactNode;
  /** Allow horizontal scroll on narrow viewports instead of wrapping/crushing columns. */
  wide?: boolean;
  /** Minimum content width when `wide` — forces the scrollbar instead of squeezing. */
  minWidth?: number;
  className?: string;
  /** Explicit `grid-template-columns` value for the `<colgroup>`, for call
   *  sites whose rows are wrapped in another component (so their `columns`
   *  prop isn't visible as a direct child here) — e.g. /status's
   *  `SourceRowV2`. Most call sites don't need this: it's inferred from the
   *  first `ListRowHead`/`ListRow` child when omitted. */
  columns?: string;
  /** REQUIRED accessible name for the table.
   *
   *  Without it a screen-reader user navigating by table (JAWS/NVDA "list
   *  tables", VoiceOver rotor) hears only "table" — with no way to tell the
   *  69-row audit ledger from the per-source uptime grid from the methodology
   *  changelog, all of which render through this component. The two hand-rolled
   *  tables in the app (dashboard board, /assets screener) already carry
   *  `aria-label`; this makes the shared one match rather than being the
   *  exception. Typed as required so a new call site cannot silently omit it. */
  label: string;
}) {
  const items = Children.toArray(children).filter(isValidElement) as Array<
    ReactElement<ColumnsProps>
  >;
  // Head detection must survive the RSC/SSR module-identity split. When these
  // rows cross a Server→Client component boundary (every marketing/editorial
  // call site — /audit, /backtest — is a Server Component passing <ListRowHead>
  // into this "use client" component), `child.type` can resolve to a different
  // function *instance* than the `ListRowHead` in this module's scope (the
  // server-RSC, SSR, and browser bundles each eval the module once). A raw
  // `===` then disagrees between the SSR HTML pass and browser hydration — the
  // head lands in <thead> on one and in <tbody> on the other → React error #418
  // (hydration mismatch), reproduced live on /audit + /backtest. `displayName`
  // is set on every instance at module eval, so it's stable across the split.
  const isHead = (c: ReactElement) =>
    c.type === ListRowHead ||
    (c.type as { displayName?: string } | null | undefined)?.displayName ===
      HEAD_DISPLAY_NAME;
  const head = items.find(isHead);
  const bodyRows = items.filter((c) => c !== head);
  const resolvedColumns =
    columns ?? head?.props.columns ?? bodyRows[0]?.props.columns;

  return (
    <div
      className={cn(
        "v2-in-lrows",
        wide && "v2-in-wide overflow-x-auto",
        className,
      )}
    >
      <div style={wide && minWidth ? { minWidth } : undefined}>
        <table className="v2-in-ltable" aria-label={label}>
          {colgroupFromTemplate(resolvedColumns)}
          {head}
          <tbody>{bodyRows}</tbody>
        </table>
      </div>
    </div>
  );
}

export function ListRowHead({
  columns,
  children,
  className,
}: {
  columns: string;
  children: ReactNode;
  className?: string;
}) {
  const style: CSSProperties = { gridTemplateColumns: columns };
  return (
    <thead>
      <tr role="row" className={cn("v2-in-lrhead", className)} style={style}>
        {Children.map(children, (child, i) => (
          <th key={i} scope="col">
            {child}
          </th>
        ))}
      </tr>
    </thead>
  );
}
// Set on every module instance at eval time, so head detection in ListRowsV2 is
// robust to the server/SSR/browser bundle identity split (React #418 fix).
ListRowHead.displayName = HEAD_DISPLAY_NAME;

export function ListRow({
  columns,
  children,
  className,
  href,
  external,
  linkLabel,
  linkCellIndex = 0,
  interactiveCells,
}: {
  columns: string;
  children: ReactNode;
  className?: string;
  /** When present, the row becomes a stretched link: an invisible overlay
   *  (`after:inset-0`, positioned against this `<tr>`) makes the whole row
   *  clickable while only one cell's content is the real, visible <a> —
   *  same mechanic as the dashboard/screener boards (see
   *  assets-screener-row.tsx's header comment). Needed because a <tr> can't
   *  itself be an <a>, the way the old all-in-one-<a> row could. */
  href?: string;
  /** Opens in a new tab with rel="noreferrer" (GitHub commits, external docs). */
  external?: boolean;
  /** Accessible name for the stretched link, for cells whose own visible
   *  content wouldn't read as a good link label on its own (e.g. a bare
   *  timestamp). Falls back to that cell's own content when omitted. */
  linkLabel?: string;
  /** Which child (0-based) hosts the visible, real <a> when `href` is set.
   *  Defaults to the first cell — the row's primary identity column, same
   *  convention as the reference board (Asset is always column 0 there). */
  linkCellIndex?: number;
  /** Cell indices that contain their OWN interactive element (a button,
   *  another link) and must sit above the row's stretched-link overlay so
   *  clicks land on the control instead of navigating the row — e.g. the
   *  audit ledger's copy-hash button. Ignored when `href` is unset. */
  interactiveCells?: number[];
}) {
  const style: CSSProperties = { gridTemplateColumns: columns };
  const cells = Children.toArray(children);
  const interactive = new Set(interactiveCells);

  return (
    <tr
      role="row"
      className={cn("v2-in-lrow", href && "relative", className)}
      style={style}
    >
      {cells.map((cell, i) => {
        if (href && i === linkCellIndex) {
          return (
            <td key={i}>
              <Link
                href={href}
                target={external ? "_blank" : undefined}
                rel={external ? "noreferrer" : undefined}
                aria-label={linkLabel}
                className="after:absolute after:inset-0 after:content-['']"
              >
                {cell}
              </Link>
            </td>
          );
        }
        return (
          <td
            key={i}
            className={href && interactive.has(i) ? "relative z-10" : undefined}
          >
            {cell}
          </td>
        );
      })}
    </tr>
  );
}
