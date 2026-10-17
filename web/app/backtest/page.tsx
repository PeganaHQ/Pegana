import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/page-metadata";
import { cn } from "@/lib/utils/cn";
import { switzerV2, geistMonoV2 } from "@/app/fonts/v2-fonts";
import { IconArrowRight } from "@/components/atoms/icon-arrow-right";
import { PageHeroV2 } from "@/components/organisms/v2/inner/page-hero-v2";
import {
  ListRowsV2,
  ListRow,
} from "@/components/organisms/v2/inner/list-rows-v2";

// Re-platformed onto V5 inner-page vocabulary (Wave 2A, 2026-07-16). Content
// unchanged from the pre-V5 version — same single replay, same facts — only
// the presentation layer moved onto .pegana-v2 / PageHeroV2 / ListRowsV2.

export const metadata: Metadata = pageMetadata({
  title: "Historical backtests",
  description:
    "Replay historical market dislocations through Pegana's versioned methodology and verify every emitted transition receipt.",
  path: "/backtest",
});

const BACKTESTS = [
  {
    slug: "2025-10-10-usde-depeg",
    date: "2025-10-10",
    version: "0.4.0",
    title: "USDe liquidation cascade",
    summary:
      "Ten assets, 43,210 one-minute observations, 123 verifiable transitions. USDe reaches CRITICAL.",
  },
];

const LEDGER_COLUMNS = "1fr auto";

export default function BacktestIndexPage() {
  return (
    <main className={cn("pegana-v2", switzerV2.variable, geistMonoV2.variable)}>
      <PageHeroV2
        eyebrow="Backtests"
        h1={
          <>
            Historical risk,{" "}
            <span className="v2-iri-text">replayed in public.</span>
          </>
        }
        maxWidthCh={22}
        lede={
          <>
            Frozen market inputs run through the same versioned methodology as
            the live engine.{" "}
            <b className="font-medium text-[var(--v2-text)]">
              Every state transition carries a receipt you can recompute.
            </b>
          </>
        }
        meta={[
          `${BACKTESTS.length} replay${BACKTESTS.length === 1 ? "" : "s"} available`,
          "byte-exact receipts",
        ]}
      />

      <div className="mx-auto max-w-[880px] px-5 pb-32 sm:px-8">
        <ListRowsV2 label="Historical backtest cases">
          {BACKTESTS.map((bt) => (
            <ListRow
              key={bt.slug}
              columns={LEDGER_COLUMNS}
              href={`/backtest/${bt.slug}`}
              linkLabel={`Open the ${bt.title} replay`}
            >
              <div className="py-1">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--v2-dim)]">
                  {bt.date} · methodology {bt.version}
                </p>
                <h2 className="mt-2 text-[19px] font-medium text-[var(--v2-text)]">
                  {bt.title}
                </h2>
                <p className="mt-2 max-w-[560px] text-[13.5px] leading-[1.6] text-[var(--v2-muted)]">
                  {bt.summary}
                </p>
              </div>
              <span className="inline-flex items-center gap-2 whitespace-nowrap text-[13px] font-medium text-[var(--v2-text)]">
                Open replay
                <IconArrowRight aria-hidden />
              </span>
            </ListRow>
          ))}
        </ListRowsV2>
      </div>
    </main>
  );
}
