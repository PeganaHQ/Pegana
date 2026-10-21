import Link from "@/components/atoms/intent-link";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/page-metadata";
import { cn } from "@/lib/utils/cn";
import { switzerV2, geistMonoV2 } from "@/app/fonts/v2-fonts";
import { inCalibrationWindow } from "@/lib/calibration";
import { assetClassForIcon, findCanonAsset } from "@/lib/asset/canon";
import { loadAssetsCanonFromRepo } from "@/lib/asset/canon-server";
import {
  AuditEmptyState,
  type AuditEmptyKind,
} from "@/components/molecules/audit-empty-state";
import {
  PageHeroV2,
  LiveDot,
} from "@/components/organisms/v2/inner/page-hero-v2";
import {
  StatStripV2,
  type StatItem,
} from "@/components/organisms/v2/inner/stat-strip-v2";
import {
  AuditLedgerTable,
  type AuditLedgerRow,
} from "@/components/organisms/audit/audit-ledger-table";
import { PillGhost } from "@/components/organisms/v2/shared";
import { displaySymbol, resolveAliasSymbol } from "@/lib/asset/display-symbol";
import { serverApiHeaders } from "@/lib/api/base";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "https://api.pegana.xyz";

// Trust-Layer v0.1.0 / Wave 10A, re-platformed onto V5 (W2, 2026-07-03).
// Public audit index. Server component: lists the 50 most recent
// non-PEGGED alerts, each linking to its receipt.
//
// The designed "calibration window" empty state (countdown + redacted
// sample feed) was dropped in Wave 2C (2026-07-16): the verdict gate
// (2026-06-11) has passed, so `inCalibrationWindow()` is now permanently
// false and that branch was dead code (see the removed
// components/organisms/audit-calibration-view.tsx). `inCalibrationWindow()`
// stays imported below — it still decides whether an "unreachable" empty
// state renders calm or critical (a live calibration window would mean the
// public feed is quiet by design, so an unreachable API reads less alarming).

type IndexRow = {
  id: string;
  asset: string;
  from_state: string;
  to_state: string;
  detected_at: string;
  methodology_version: string;
  receipt_sha256: string;
  onchain_tx_sig: string | null;
};

type FetchResult =
  { status: "ok"; rows: IndexRow[] } | { status: "unreachable" };

async function fetchIndex(
  stateFilter: string | null,
  assetFilter: string | null,
): Promise<FetchResult> {
  const params = new URLSearchParams({ limit: "50", exclude_pegged: "true" });
  if (stateFilter) params.set("state", stateFilter);
  if (assetFilter) params.set("asset", assetFilter);
  try {
    const r = await fetch(`${API_BASE}/v1/audit?${params.toString()}`, {
      headers: serverApiHeaders(),
      next: { revalidate: 60 },
    });
    if (!r.ok) {
      console.warn("audit index fetch non-ok", r.status);
      return { status: "unreachable" };
    }
    const rows = (await r.json()) as IndexRow[];
    return { status: "ok", rows };
  } catch (err) {
    console.error("audit index fetch error", err);
    return { status: "unreachable" };
  }
}

function pickEmptyKind(fetchStatus: "ok" | "unreachable"): AuditEmptyKind {
  if (fetchStatus === "unreachable") return "unreachable";
  return "post-gate-empty";
}

export const metadata: Metadata = pageMetadata({
  title: "Recent audits",
  description:
    "Browse the 50 most recent verifiable peg-risk alerts. Each row links to a cryptographically reproducible audit receipt.",
  path: "/audit",
});

function formatTs(iso: string): string {
  return iso.replace("T", " ").slice(0, 19);
}

// Real, queryable filters (mirrors the API's ALLOWED_STATE_FILTERS below) —
// the artifact's 5th pill was labelled "Unknown", but the audit API has no
// UNKNOWN filter (UNKNOWN isn't a transition end-state that gets indexed
// here); BLACK_SWAN is what's actually queryable, so the pill row reflects
// what /v1/audit really supports rather than the artifact's exact label.
const STATE_FILTERS: Array<{ label: string; value: string | null }> = [
  { label: "All", value: null },
  { label: "Drift", value: "DRIFT" },
  { label: "Depeg", value: "DEPEG" },
  { label: "Critical", value: "CRITICAL" },
  { label: "Black Swan", value: "BLACK_SWAN" },
];

const ALLOWED_STATE_FILTERS = new Set([
  "DRIFT",
  "DEPEG",
  "CRITICAL",
  "BLACK_SWAN",
]);

// Headline emphasis color per filter state — plain colored text (no
// iridescent gradient here; the artifact reserves that single per-page
// moment for the fraction bar on /methodology and "read." on /about).
const STATE_HEADLINE_COLOR: Record<string, string> = {
  DRIFT: "var(--v2-drift)",
  DEPEG: "var(--v2-depeg)",
  CRITICAL: "var(--v2-crit)",
  BLACK_SWAN: "var(--v2-crit)",
};

export default async function AuditIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; asset?: string }>;
}) {
  const params = await searchParams;
  const rawState = (params.state ?? "").toUpperCase();
  const stateFilter = ALLOWED_STATE_FILTERS.has(rawState) ? rawState : null;
  // Sanitise the asset param to the API's own symbol charset (1-32 chars of
  // letters, digits and . _ + * -; real symbols include wBTC.e, hyloSOL+ and
  // USD*). Anything else is dropped before forwarding; URLSearchParams encodes
  // the value on the way out.
  const rawAsset = params.asset ?? "";
  // A display alias (eHYUSD) resolves to the canonical API symbol (sHYUSD)
  // for the fetch and the CSV link; the header prints `assetShown`, the same
  // display label the rows use.
  const assetFilter =
    rawAsset.length > 0 && /^[A-Za-z0-9._+*-]{1,32}$/.test(rawAsset)
      ? resolveAliasSymbol(rawAsset)
      : null;
  const assetShown = assetFilter ? displaySymbol(assetFilter) : null;
  const [fetched, canon] = await Promise.all([
    fetchIndex(stateFilter, assetFilter),
    loadAssetsCanonFromRepo("audit page"),
  ]);
  const rows = fetched.status === "ok" ? fetched.rows : [];
  const inWindow = inCalibrationWindow();
  const emptyKind = pickEmptyKind(fetched.status);

  // Resolved server-side so the client table only receives plain data. An
  // asset missing from the canon (retired xSOL / pbUSDC receipts) keeps its
  // row and renders the monogram fallback.
  const ledgerRows: AuditLedgerRow[] = rows.map((r) => {
    const meta = findCanonAsset(canon, r.asset);
    return {
      id: r.id,
      asset: r.asset,
      symbol: displaySymbol(r.asset),
      mint: meta?.mint ?? null,
      klass: assetClassForIcon(meta?.className) ?? null,
      fromState: r.from_state,
      toState: r.to_state,
      detectedAt: formatTs(r.detected_at),
      methodologyVersion: r.methodology_version,
      receiptSha256: r.receipt_sha256,
      anchored: r.onchain_tx_sig != null,
    };
  });

  // CSV export requires from+to (CsvParams, non-Option) — a bare ?limit=50 link
  // 400s. Wire a valid default 90-day window ending now, carrying the active
  // asset filter so the download matches the viewed rows. (CsvParams accepts
  // no `state`/`limit`, so those are deliberately omitted.)
  const csvTo = new Date();
  const csvFrom = new Date(csvTo.getTime() - 90 * 24 * 60 * 60 * 1000);
  const csvParams = new URLSearchParams({
    from: csvFrom.toISOString(),
    to: csvTo.toISOString(),
  });
  if (assetFilter) csvParams.set("asset", assetFilter);
  const csvHref = `${API_BASE}/v1/audit.csv?${csvParams.toString()}`;

  // Stats built only from what this fetch actually knows — no fabricated
  // "30d" window or 100%-replayable claim we can't verify from the index.
  const uniqueAssets = new Set(rows.map((r) => r.asset)).size;
  const newestVersion = rows[0]?.methodology_version ?? null;
  const statItems: StatItem[] = [];
  if (rows.length > 0)
    statItems.push({ value: rows.length, label: "Recent transitions" });
  if (uniqueAssets > 0)
    statItems.push({ value: uniqueAssets, label: "Assets in view" });
  if (newestVersion)
    statItems.push({ value: `v${newestVersion}`, label: "Methodology" });

  return (
    <main className={cn("pegana-v2", switzerV2.variable, geistMonoV2.variable)}>
      <PageHeroV2
        eyebrow="Audit log"
        h1={
          stateFilter ? (
            <>
              Recent alerts in{" "}
              <span style={{ color: STATE_HEADLINE_COLOR[stateFilter] }}>
                {STATE_FILTERS.find((f) => f.value === stateFilter)?.label}
              </span>
              .
            </>
          ) : assetFilter ? (
            <>
              Verifiable alerts for <b className="font-medium">{assetShown}</b>
              .
            </>
          ) : (
            "Every alert ships a receipt."
          )
        }
        maxWidthCh={26}
        lede={
          <>
            Pegana watches Solana pegged assets, compares market price to
            intrinsic value, and seals each state change into a{" "}
            <b className="font-medium text-[var(--v2-text)]">
              content-addressed receipt
            </b>
            , reproducible from the inputs the methodology saw.
            {stateFilter && (
              <>
                {" "}
                Showing only rows whose end-state is {stateFilter}.{" "}
                <Link href="/audit" className="underline">
                  Clear filter
                </Link>
                .
              </>
            )}
            {assetFilter && (
              <>
                {" "}
                Showing only rows for {assetShown}.{" "}
                <Link href="/audit" className="underline">
                  Clear filter
                </Link>
                .
              </>
            )}
          </>
        }
        meta={[
          fetched.status === "ok" ? (
            <LiveDot key="live">ledger live</LiveDot>
          ) : (
            <span key="live" className="text-[var(--v2-crit)]">
              feed unreachable
            </span>
          ),
          rows.length > 0
            ? "showing recent rows below · full history at /v1/audit"
            : assetFilter
              ? `no non-pegged transitions recorded for ${assetShown}`
              : stateFilter
                ? `no ${stateFilter.toLowerCase()} transitions in view`
                : "no non-pegged transitions recorded yet",
        ]}
      />

      <div className="mx-auto max-w-[880px] px-5 pb-32 sm:px-8">
        <StatStripV2 items={statItems} />

        {/* One row at every width. Below sm the row scrolls sideways under a
            40px right-edge fade (the PillTabs toolbar idiom); the trailing
            pr-10 lets the last pill scroll clear of the fade. v2.css makes
            .v2-in-ptabs wrap and squares its radius on phones, so both are
            overridden here rather than in the shared stylesheet. */}
        <div className="overflow-x-auto [scrollbar-width:none] max-sm:[-webkit-mask-image:linear-gradient(to_right,#000_calc(100%_-_40px),transparent)] max-sm:[mask-image:linear-gradient(to_right,#000_calc(100%_-_40px),transparent)] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max pb-1 pr-10 sm:pr-0">
            <div
              className="v2-in-ptabs flex-nowrap! rounded-full!"
              role="group"
              aria-label="Filter by state"
            >
              {STATE_FILTERS.map((f) => {
                const isActive = f.value === stateFilter;
                const href = f.value ? `/audit?state=${f.value}` : "/audit";
                return (
                  <Link
                    key={f.label}
                    href={href}
                    className={cn("v2-in-ptab", isActive && "v2-in-on")}
                    aria-current={isActive ? "page" : undefined}
                  >
                    {f.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        <AuditLedgerTable
          rows={ledgerRows}
          resetKey={`${stateFilter ?? ""}|${assetFilter ?? ""}`}
          empty={
            <div className="mt-6">
              <AuditEmptyState
                kind={emptyKind}
                inCalibrationWindow={inWindow}
                apiBase={API_BASE}
                stateFilter={stateFilter}
              />
            </div>
          }
        />
        {ledgerRows.length > 0 && (
          <p className="mt-3 font-mono text-[12px] text-[var(--v2-dim)]">
            click a row for the receipt
          </p>
        )}

        <hr className="v2-in-hr" />
        <h2 className="mb-4 text-[26px] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--v2-text)]">
          Programmatic access
        </h2>
        <div className="flex flex-wrap gap-2.5">
          <PillGhost href={`${API_BASE}/v1/audit?limit=50`}>
            GET /v1/audit
          </PillGhost>
          <PillGhost href="/audit.xml">audit.xml</PillGhost>
          <PillGhost href="/calibration.xml">calibration.xml</PillGhost>
          <PillGhost href={csvHref}>CSV export</PillGhost>
        </div>
      </div>
    </main>
  );
}
