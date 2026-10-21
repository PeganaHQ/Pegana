"use client";

import type { ReactNode } from "react";
import Link from "@/components/atoms/intent-link";
import { TokenIcon } from "@/components/atoms/token-icon";
import { HashChip } from "@/components/molecules/hash-chip";
import { Pagination } from "@/components/molecules/pagination";
import { PlainTh } from "@/components/organisms/lst/lst-directory-table-v2";
import { StatePillV2 } from "@/components/organisms/v2/shared";
import { usePagination } from "@/lib/hooks/use-pagination";
import { classTint, monogramInitials } from "@/lib/token-icons/monogram";
import type { AssetClass, PegState } from "@/lib/api/types";

// /audit ledger table (r3, 2026-10-21). Replaces the editorial grid-as-table
// (ListRowsV2/ListRow) with the canonical LST directory table mechanic:
// a real <table table-fixed> with an explicit <colgroup>, PlainTh headers,
// a stretched link per row, and the shared client-side pagination. Below `sm`
// the table is swapped for a sibling card list (same split as /dashboard), so
// the table's fixed column math never forces a horizontal page scroll on a
// phone.
//
// Type floor: all text here is at least 12px. PlainTh itself sets 10px on the
// <th>; its label is wrapped in a 12px span rather than editing the shared
// header (the LST directory keeps its own sizing). The one exception is the
// decorative, aria-hidden monogram glyph inside the 22px asset mark (8px, the
// same as TokenIcon's own failed-image fallback).

// Sized for the 880px column (814px panel), measured on a preview at 1440:
// When fits "YYYY-MM-DD HH:MM:SS" (137px) on one line; Transition fits the
// widest pill pair (Critical -> Critical, 208px) on one line; Asset fits the
// longest live symbol (corvusSOL, 68px) beside its icon; Receipt fits the
// 8-char hash chip (~99px).
const COL_WIDTHS = ["23%", "18%", "31%", "10%", "18%"];
const PER_PAGE = 25;

export interface AuditLedgerRow {
  id: string;
  /** Raw API symbol, used in the accessible link label. */
  asset: string;
  /** Display symbol (displaySymbol(asset)). */
  symbol: string;
  /** Canon mint, or null when the asset is not in the canon (retired assets
   *  such as xSOL / pbUSDC). Null renders the monogram fallback. */
  mint: string | null;
  klass: AssetClass | null;
  fromState: string;
  toState: string;
  /** Pre-formatted UTC timestamp, "YYYY-MM-DD HH:MM:SS". */
  detectedAt: string;
  methodologyVersion: string;
  receiptSha256: string;
  anchored: boolean;
}

function receiptHref(row: AuditLedgerRow): string {
  return `/audit/${row.id}`;
}

function linkLabel(row: AuditLedgerRow): string {
  return `View receipt: ${row.asset} ${row.fromState} to ${row.toState}, ${row.detectedAt}`;
}

function AssetMark({ row }: { row: AuditLedgerRow }) {
  if (row.mint) {
    return (
      <TokenIcon
        mint={row.mint}
        symbol={row.symbol}
        klass={row.klass ?? undefined}
        size={22}
        className="v2-in-tokenicon"
      />
    );
  }
  // Unknown to the canon: same silhouette as TokenIcon's own failed-image
  // fallback, without requesting a logo file that cannot exist.
  const tint = classTint(row.klass ?? undefined);
  return (
    <span
      aria-hidden
      data-testid="audit-asset-monogram"
      className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--v2-bg2)] font-mono text-[8px] font-semibold leading-none tracking-[-0.02em]"
      style={{ boxShadow: `inset 0 0 0 1px ${tint}66`, color: tint }}
    >
      {monogramInitials(row.symbol)}
    </span>
  );
}

function Transition({ row }: { row: AuditLedgerRow }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <StatePillV2 state={row.fromState as PegState} />
      <span aria-hidden className="text-[12px] text-[var(--v2-dim)]">
        &#8594;
      </span>
      <StatePillV2 state={row.toState as PegState} />
    </span>
  );
}

function Receipt({ row }: { row: AuditLedgerRow }) {
  // relative z-10 lifts the copy button above the row's stretched-link
  // overlay, so a click copies the hash instead of navigating.
  return (
    <span className="relative z-10 flex items-center gap-2">
      <HashChip
        full={row.receiptSha256}
        display={`${row.receiptSha256.slice(0, 8)}…`}
        className="text-[12px]!"
      />
      {row.anchored && (
        <span className="font-mono text-[12px] text-[var(--v2-peg)]">
          anchored
        </span>
      )}
    </span>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <PlainTh>
      <span className="text-[12px]">{children}</span>
    </PlainTh>
  );
}

export function AuditLedgerTable({
  rows,
  empty,
  resetKey,
}: {
  rows: AuditLedgerRow[];
  /** Rendered instead of the table when there are no rows. */
  empty?: ReactNode;
  /** Serialized filter state (e.g. `state|asset`). A soft navigation between
   *  filters keeps this component mounted, so without it the page number
   *  would carry over to the new result set. */
  resetKey?: string;
}) {
  const pagination = usePagination({
    items: rows,
    pageSize: PER_PAGE,
    resetKey,
    itemNoun: "receipt",
  });
  const paged = pagination.pageItems;

  if (rows.length === 0) {
    return (
      <div data-testid="audit-ledger-empty">
        {empty ?? (
          <p className="font-mono text-[12px] text-[var(--v2-muted)]">
            No receipts in view.
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <div ref={pagination.anchorRef} className="mt-5">
        {/* Mobile: card list, never inside the table (see /dashboard's
            DashboardBoardMobileCard for why). */}
        <ul
          aria-label="Recent audit receipts"
          className="divide-y divide-[var(--v2-line)] overflow-hidden rounded-[16px] border border-[var(--v2-line)] sm:hidden"
        >
          {paged.map((row) => (
            <li
              key={row.id}
              className="relative px-4 py-3.5 transition-[background-color] duration-150 hover:bg-white/[0.02]"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <AssetMark row={row} />
                  <Link
                    href={receiptHref(row)}
                    aria-label={linkLabel(row)}
                    className="truncate text-[15px] font-medium text-[var(--v2-text)] after:absolute after:inset-0 after:content-['']"
                  >
                    {row.symbol}
                  </Link>
                </span>
                <span className="shrink-0 font-mono text-[12px] tabular-nums text-[var(--v2-muted)]">
                  {row.detectedAt}
                </span>
              </div>
              <div className="mt-2">
                <Transition row={row} />
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-3">
                <span className="font-mono text-[12px] tabular-nums text-[var(--v2-muted)]">
                  v{row.methodologyVersion}
                </span>
                <Receipt row={row} />
              </div>
            </li>
          ))}
        </ul>

        {/* Desktop: the LST directory table mechanic. */}
        <div
          data-scroll-contain
          className="hidden overflow-x-auto rounded-[16px] border border-[var(--v2-line)] sm:block"
        >
          <div style={{ minWidth: 720 }}>
            <table
              className="w-full table-fixed border-collapse text-left"
              aria-label="Recent audit receipts"
            >
              <colgroup>
                {COL_WIDTHS.map((w, i) => (
                  <col key={i} style={{ width: w }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <Th>When · UTC</Th>
                  <Th>Asset</Th>
                  <Th>Transition</Th>
                  <Th>Method</Th>
                  <Th>Receipt</Th>
                </tr>
              </thead>
              <tbody>
                {paged.map((row) => (
                  <tr
                    key={row.id}
                    className="relative border-t border-[var(--v2-line)] transition-[background-color] duration-150 hover:bg-white/[0.02]"
                  >
                    <td className="px-4 py-3.5 font-mono text-[12px] tabular-nums text-[var(--v2-muted)] sm:px-5">
                      {row.detectedAt}
                    </td>
                    <td className="px-4 py-3.5 sm:px-5">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <AssetMark row={row} />
                        <Link
                          href={receiptHref(row)}
                          aria-label={linkLabel(row)}
                          className="truncate text-[13.5px] font-medium text-[var(--v2-text)] after:absolute after:inset-0 after:content-[''] hover:underline"
                        >
                          {row.symbol}
                        </Link>
                      </span>
                    </td>
                    <td className="px-4 py-3.5 sm:px-5">
                      <Transition row={row} />
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[12px] tabular-nums text-[var(--v2-muted)] sm:px-5">
                      v{row.methodologyVersion}
                    </td>
                    <td className="px-4 py-3.5 sm:px-5">
                      <Receipt row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Pagination state={pagination} ariaLabel="Audit receipt pages" />
    </>
  );
}
