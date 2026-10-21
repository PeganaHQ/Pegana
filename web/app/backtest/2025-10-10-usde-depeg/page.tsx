import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/page-metadata";
import Link from "@/components/atoms/intent-link";
import dynamic from "next/dynamic";

import { cn } from "@/lib/utils/cn";
import { switzerV2, geistMonoV2 } from "@/app/fonts/v2-fonts";
import { BandGauge } from "@/components/atoms/band-gauge";
import { discountToBps, formatGap } from "@/lib/api/format";
import { isDirectionSensitiveClass } from "@/lib/asset/chart-thresholds";
import { PageHeroV2 } from "@/components/organisms/v2/inner/page-hero-v2";
import {
  StatStripV2,
  type StatItem,
} from "@/components/organisms/v2/inner/stat-strip-v2";
import {
  ListRowsV2,
  ListRowHead,
  ListRow,
} from "@/components/organisms/v2/inner/list-rows-v2";
import {
  PillPrimary,
  PillGhost,
  StatePillV2,
} from "@/components/organisms/v2/shared";

import {
  asPegState,
  assetClass,
  backtest,
  chartPoints,
  receiptsByHash,
  thresholds,
} from "./backtest-data";
import { StaticReceiptVerifier } from "./static-receipt-verifier";

// Re-platformed onto V5 inner-page vocabulary (Wave 2A, 2026-07-16). Content
// unchanged from the pre-V5 version — same facts, same receipts — only the
// presentation layer moved onto .pegana-v2 / PageHeroV2 / StatStripV2 /
// ListRowsV2. BacktestChart + BandGauge kept as-is (only their surrounding
// container was restyled).

// recharts is ~95 KB gzipped; keep it out of this Server Component's initial
// JS payload by code-splitting the chart into its own client chunk (`ssr:
// false` isn't valid here — this file is a Server Component).
const BacktestChart = dynamic(() =>
  import("./backtest-chart").then((mod) => mod.BacktestChart),
);

export const metadata: Metadata = pageMetadata({
  title: "2025-10-10 USDe cascade backtest",
  description:
    "Replay the October 10, 2025 USDe liquidation cascade across ten assets through Pegana methodology 0.4.0.",
  path: "/backtest/2025-10-10-usde-depeg",
});

const ASSET_ORDER = [
  "USDe",
  "PYUSD",
  "USDC",
  "USDT",
  "USDS",
  "sUSDe",
  "jitoSOL",
  "mSOL",
  "bSOL",
  "INF",
] as const;

const FIXTURE_START = Date.parse("2025-10-09T00:00:00Z");

const RECEIPT_COLUMNS = "190px 1fr 230px";

function alertTime(seconds: number | null) {
  if (seconds == null) return "No alert";
  const instant = new Date(FIXTURE_START + seconds * 1000);
  return (
    instant.toISOString().slice(5, 16).replace("T", " ") +
    " UTC · " +
    Math.floor(seconds / 3600) +
    "h " +
    Math.floor((seconds % 3600) / 60) +
    "m into fixture"
  );
}

function transitionTime(value: string) {
  return value.replace("T", " ").replace("+00:00", " UTC");
}

const STAT_ITEMS: StatItem[] = [
  { value: "$0.95331862", label: "Pyth candle low" },
  { value: "CRITICAL", label: "USDe maximum state", color: "var(--v2-crit)" },
  { value: "123", label: "Verifiable receipts" },
];

export default function UsdeCascadeBacktestPage() {
  return (
    <main className={cn("pegana-v2", switzerV2.variable, geistMonoV2.variable)}>
      <div className="mx-auto max-w-[880px] px-5 pb-4 pt-16 sm:px-8 sm:pt-24">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--v2-muted)]">
          <Link
            href="/backtest"
            className="transition-colors hover:text-[var(--v2-text)]"
          >
            Backtests
          </Link>
          <span className="mx-2">/</span>
          <span>USDe cascade</span>
        </p>
      </div>
      <PageHeroV2
        eyebrow="Backtest · 2025-10-10"
        h1={
          <>
            USDe reached{" "}
            <span style={{ color: "var(--v2-crit)" }}>CRITICAL.</span>
          </>
        }
        maxWidthCh={22}
        lede={
          <>
            On October 10, 2025, more than $19 billion in leveraged positions
            unwound. This replay freezes 43,210 Pyth observations from that
            event and runs them through methodology 0.4.0.{" "}
            <b className="font-medium text-[var(--v2-text)]">
              Eight USDe state changes are independently verifiable.
            </b>
          </>
        }
        meta={[
          "October 10, 2025",
          "methodology 0.4.0",
          "10 assets · 43,210 observations",
        ]}
        className="pb-6"
      />

      <div className="mx-auto max-w-[880px] px-5 pb-32 sm:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <PillPrimary href="/audit?asset=USDe">
            Open live USDe audit
          </PillPrimary>
          <PillGhost href="/methodology">Read methodology</PillGhost>
        </div>

        <StatStripV2 items={STAT_ITEMS} />

        <h2 className="mt-6 text-[26px] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--v2-text)]">
          Ten assets, one methodology.
        </h2>
        <p className="mt-4 max-w-[64ch] text-[15px] leading-[1.65] text-[var(--v2-muted)]">
          Charts show fifteen-minute samples plus every transition tick. Shaded
          bands mark each asset&apos;s drift, depeg, and critical thresholds;
          vertical rules mark committed state changes.
        </p>

        <div className="mt-12 space-y-14">
          {ASSET_ORDER.map((symbol) => {
            const asset = backtest.assets[symbol];
            const assetThresholds = thresholds[symbol];
            const latestTransition = asset.transitions.at(-1);
            const gaugeBps = latestTransition
              ? (discountToBps(latestTransition.discount_smooth) ?? 0)
              : 0;

            return (
              <article
                key={symbol}
                className="border-t border-[var(--v2-line)] pt-10"
              >
                <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <h3 className="text-[22px] font-medium text-[var(--v2-text)]">
                        {symbol}
                      </h3>
                      <StatePillV2 state={asPegState(asset.max_state)} />
                    </div>
                    <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--v2-muted)]">
                      {asset.fidelity}
                    </p>
                    <p className="mt-5 text-[13.5px] leading-relaxed text-[var(--v2-muted)]">
                      First alert:{" "}
                      <span className="font-mono text-[12px] text-[var(--v2-text)]">
                        {alertTime(asset.time_to_first_alert_secs)}
                      </span>
                    </p>
                    <div className="mt-5">
                      <BandGauge
                        bps={gaugeBps}
                        thresholds={assetThresholds}
                        state={asPegState(asset.max_state)}
                      />
                    </div>
                  </div>

                  <div className="min-w-0 rounded-[16px] border border-[var(--v2-line)] bg-[var(--v2-panel)] p-3 sm:p-5">
                    <BacktestChart
                      symbol={symbol}
                      points={chartPoints(symbol)}
                      transitions={asset.transitions}
                      thresholds={assetThresholds}
                      directionSensitive={isDirectionSensitiveClass(
                        assetClass(symbol) ?? "",
                      )}
                    />
                  </div>
                </div>

                <details className="mt-6">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between border-t border-[var(--v2-line)] py-3 text-[13.5px] font-medium text-[var(--v2-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--v2-text)]">
                    <span>
                      Transition receipts{" "}
                      <span className="font-mono text-[11px] text-[var(--v2-muted)]">
                        ({asset.transitions.length})
                      </span>
                    </span>
                    <span aria-hidden className="text-[var(--v2-muted)]">
                      +
                    </span>
                  </summary>
                  {asset.transitions.length === 0 ? (
                    <p className="border-t border-[var(--v2-line)] py-5 text-[13.5px] text-[var(--v2-muted)]">
                      No state transitions. The asset remained PEGGED.
                    </p>
                  ) : (
                    <ListRowsV2 label="Backtest receipt ledger" wide minWidth={680}>
                      <ListRowHead columns={RECEIPT_COLUMNS}>
                        <span>Transition</span>
                        <span>Time · gap · hash</span>
                        <span>Verify</span>
                      </ListRowHead>
                      {asset.transitions.map((transition) => {
                        const bundle = receiptsByHash.get(
                          transition.receipt_sha256,
                        );
                        return (
                          <ListRow
                            key={transition.receipt_sha256}
                            columns={RECEIPT_COLUMNS}
                          >
                            <span className="flex items-center gap-1.5">
                              <StatePillV2
                                state={asPegState(transition.from)}
                              />
                              <span
                                aria-hidden
                                className="text-[var(--v2-muted)]"
                              >
                                &#8594;
                              </span>
                              <StatePillV2 state={asPegState(transition.to)} />
                            </span>
                            <span>
                              <span className="v2-in-num block text-[12px] text-[var(--v2-muted)]">
                                {transitionTime(transition.t)} ·{" "}
                                {formatGap(
                                  -(discountToBps(transition.discount_smooth) ??
                                    0),
                                )}
                              </span>
                              <span className="mt-1 block break-all font-mono text-[10px] text-[var(--v2-muted)]">
                                {transition.receipt_sha256}
                              </span>
                            </span>
                            <span>
                              {bundle ? (
                                <StaticReceiptVerifier bundle={bundle} />
                              ) : (
                                <span
                                  className="text-[12px]"
                                  style={{ color: "var(--v2-crit)" }}
                                >
                                  Receipt bundle missing.
                                </span>
                              )}
                            </span>
                          </ListRow>
                        );
                      })}
                    </ListRowsV2>
                  )}
                </details>
              </article>
            );
          })}
        </div>

        <div className="mt-20 rounded-[16px] border border-[var(--v2-line)] bg-[var(--v2-panel)] p-6 sm:p-8">
          <h2 className="text-[17px] font-medium text-[var(--v2-text)]">
            Historical replay, not a live alert.
          </h2>
          <p className="mt-3 max-w-[70ch] text-[14px] leading-[1.65] text-[var(--v2-muted)]">
            Hypothetical backtest against real historical Pyth data. No live
            alert was emitted on this date. Methodology v0.4.0, unmodified.
            USDT&apos;s DEPEG result comes from a sustained premium in the Pyth
            series because stable_fiat bands are symmetric.
          </p>
        </div>
      </div>
    </main>
  );
}
