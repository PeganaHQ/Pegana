import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/page-metadata";
import { cn } from "@/lib/utils/cn";
import { switzerV2, geistMonoV2 } from "@/app/fonts/v2-fonts";
import { fetchLstDirectory } from "@/lib/lst/fetch-directory";
import { fetchPeganaLstAssets } from "@/lib/lst/fetch-pegana-lst";
import { mergeLstDirectory, buildFallbackRows } from "@/lib/lst/merge";
import { formatCompactUsd } from "@/lib/lst/format";
import {
  PageHeroV2,
  LiveDot,
} from "@/components/organisms/v2/inner/page-hero-v2";
import {
  StatStripV2,
  type StatItem,
} from "@/components/organisms/v2/inner/stat-strip-v2";
import { PillGhost, PillPrimary } from "@/components/organisms/v2/shared";
import { LstDirectoryTableV2 } from "@/components/organisms/lst/lst-directory-table-v2";

// Public LST peg-risk directory. Server component: fetches the LST universe
// (lst-directory.com, maintained by Hylo — TVL/APY/rate, refreshed ~15m) and
// Pegana's own live verdicts (/v1/assets?class=lst, refreshed 60s) in
// parallel, merges them (lib/lst/merge.ts), and renders every liquid Solana
// LST ranked by TVL with Pegana's committed state where we cover it. This is
// the gap the rest of the market leaves: DefiLlama shows a raw peg ratio,
// Sanctum shows exit liquidity — neither publishes a peg-risk verdict.

// Title trimmed from 78 chars to 29: with the root template's " — Pegana" the
// old one ran to ~88 and Google truncated it mid-question, so the keyword that
// mattered ("holding its peg") never rendered in the SERP. The full framing
// still leads the page body and the meta description.
export const metadata: Metadata = pageMetadata({
  title: "Solana LST peg-risk directory",
  description:
    "Every liquid Solana LST, ranked by TVL, with Pegana's live peg-risk verdict. A raw stake-pool ratio gives you the exchange rate. Not whether the market price has drifted from it, or by how much.",
  path: "/lst",
});

export default async function LstDirectoryPage() {
  const [directory, peganaLst] = await Promise.all([
    fetchLstDirectory(),
    fetchPeganaLstAssets(),
  ]);

  const source: "directory" | "fallback" =
    directory.status === "ok" ? "directory" : "fallback";
  // Our own API, not the third party. When this is down every row would
  // otherwise read "not yet covered", stating a coverage fact we have not
  // established. The table renders those cells as unverifiable instead.
  const verdictsUnavailable = peganaLst.status === "error";
  const rows =
    directory.status === "ok"
      ? mergeLstDirectory(directory.rows, peganaLst.assets)
      : buildFallbackRows(peganaLst.assets);

  const coveredCount = rows.filter((r) => r.covered).length;
  const totalTvl = rows.reduce((sum, r) => sum + (r.tvlUsd ?? 0), 0);

  const statItems: StatItem[] = [
    {
      value: rows.length,
      label:
        source === "directory" ? "LSTs in the directory" : "LSTs Pegana tracks",
    },
    // With our own API down, coveredCount is 0 by construction, and printing
    // "0 Covered by Pegana" is the same false claim the row pills used to make.
    {
      value: verdictsUnavailable ? "-" : coveredCount,
      label: verdictsUnavailable
        ? "Covered by Pegana (unavailable)"
        : "Covered by Pegana",
      color: verdictsUnavailable ? undefined : "var(--v2-peg)",
    },
  ];
  if (source === "directory" && totalTvl > 0) {
    statItems.push({
      value: formatCompactUsd(totalTvl),
      label: "Combined TVL",
    });
  }

  return (
    <main className={cn("pegana-v2", switzerV2.variable, geistMonoV2.variable)}>
      <PageHeroV2
        eyebrow="LST directory"
        h1="Every Solana LST. One peg-risk verdict."
        maxWidthCh={22}
        lede={
          <>
            DefiLlama shows a raw peg ratio. Sanctum shows exit liquidity.
            Neither tells you whether the peg is actually holding right now.
            This is every liquid Solana LST, ranked by TVL, with{" "}
            <b className="font-medium text-[var(--v2-text)]">
              Pegana&rsquo;s live peg-risk verdict
            </b>{" "}
            wherever we cover it.
          </>
        }
        meta={[
          source === "directory" ? (
            <LiveDot key="live">
              Universe from lst-directory.com &middot; refreshed every 15m
            </LiveDot>
          ) : (
            <span key="live" className="text-[var(--v2-drift)]">
              lst-directory.com unreachable. Showing Pegana&rsquo;s own
              tracked LSTs
            </span>
          ),
          `${coveredCount} of ${rows.length} covered`,
        ]}
      />

      <div className="mx-auto max-w-[880px] px-5 pb-32 sm:px-8">
        <StatStripV2 items={statItems} />

        <div className="mb-4 mt-9 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 className="text-[19px] font-medium tracking-[-0.01em] text-[var(--v2-text)]">
            The universe
          </h2>
          <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--v2-dim)]">
            Ranked by TVL &middot; verdict where Pegana covers it
          </p>
        </div>

        {verdictsUnavailable && (
          <p
            role="status"
            className="mb-4 flex items-center gap-2 border border-st-drift/40 px-4 py-3 font-mono text-[12px] leading-[1.6] text-st-drift"
          >
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-st-drift"
            />
            Peg verdicts are temporarily unavailable. The directory below is
            complete; the verdict column is not a statement about coverage.
          </p>
        )}
        <LstDirectoryTableV2
          rows={rows}
          source={source}
          verdictsUnavailable={verdictsUnavailable}
        />

        {source === "directory" && (
          <p className="mt-4 font-mono text-[12px] leading-[1.6] text-[var(--v2-dim)]">
            Universe, TVL &amp; APY from{" "}
            <a
              href="https://lst-directory.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--v2-muted)]"
            >
              lst-directory.com
            </a>{" "}
            (Hylo, read straight from chain). Peg-risk verdicts are
            Pegana&rsquo;s own.
          </p>
        )}

        <hr className="v2-in-hr" />
        <h2 className="mb-3 text-[26px] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--v2-text)]">
          Why a verdict, not just a ratio.
        </h2>
        <p className="v2-in-prose">
          A stake-pool&rsquo;s SOL-per-share rate tells you the exchange rate.
          It doesn&rsquo;t tell you whether the market price has drifted from
          that intrinsic value, by how much, or since when. Pegana computes that
          spread continuously for every LST it covers and commits each state
          change, Pegged, Drift, Depeg, Critical, into a signed,
          replayable receipt the moment it happens.
        </p>
        <div className="mt-8 flex flex-wrap gap-3.5">
          <PillPrimary href={"/dashboard"}>
            open the dashboard
          </PillPrimary>
          <PillGhost href="https://docs.pegana.xyz/guides/rest-api">assets api</PillGhost>
        </div>
      </div>
    </main>
  );
}
