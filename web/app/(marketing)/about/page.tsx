import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/page-metadata";
import { cn } from "@/lib/utils/cn";
import { switzerV2, geistMonoV2 } from "@/app/fonts/v2-fonts";
import { AboutNowWidget } from "@/components/molecules/about-now-widget";
import { getRecentCommits } from "@/lib/github-commits";
import { PageHeroV2 } from "@/components/organisms/v2/inner/page-hero-v2";
import {
  ListRowsV2,
  ListRow,
} from "@/components/organisms/v2/inner/list-rows-v2";
import { PillPrimary, PillGhost } from "@/components/organisms/v2/shared";

export const metadata: Metadata = pageMetadata({
  title: "About",
  description: "Why Pegana exists, who it's for, and how it's built.",
  path: "/about",
});

// Founder manifesto 2.0 (V5 W2, 2026-07-03 — content rewritten and approved
// in the pegana-w2-pages.html artifact; reproduced verbatim below).
const MANIFESTO = [
  <>
    Every Solana protocol that uses an LST or a stablecoin as collateral assumes
    its peg holds. Most only find out it slipped when the orderbook reprices and
    a liquidation cascade is already underway.{" "}
    <b className="font-medium text-[var(--v2-text)]">
      The tooling to watch that gap didn&apos;t exist on Solana the way it does
      on Ethereum.
    </b>
  </>,
  <>
    So I&apos;m building it. One repo, one operator. Open source, open
    methodology, same thresholds for everyone.
  </>,
  <>
    Since launch, the watching became provable. Every alert now ships as a{" "}
    <b className="font-medium text-[var(--v2-text)]">
      content-addressed receipt
    </b>
    : the frozen inputs, the canon hash, the methodology version. A self-hosted
    CLI replays any receipt byte-exact on your machine. Some receipts are
    anchored on Solana itself. When the answer is uncertain, Pegana prints{" "}
    <b className="font-medium text-[var(--v2-text)]">Unknown</b> instead of
    guessing, and every incident our monitoring catches goes on the public
    status page, permanently.
  </>,
  <>
    The methodology crate is on crates.io. The asset canon, the ADRs and the
    replay CLI live in the public repo. If you disagree with a verdict, you
    don&apos;t have to trust me:{" "}
    <b className="font-medium text-[var(--v2-text)]">replay it.</b>
  </>,
];

const ORACLE_READERS = [
  {
    who: "Insurance",
    what: "Trigger payouts on a recorded peg event, with the receipt as the claim's evidence.",
  },
  {
    who: "Prediction markets",
    what: "Resolve markets on the recorded spread, not on a screenshot.",
  },
  {
    who: "Lending",
    what: "Adjust collateral parameters before a liquidation cascade, not after.",
  },
];

const FACTS = [
  {
    label: "Open where it matters",
    body: "Methodology crate on crates.io, canon + ADRs in the public repo, REST and WebSocket public with no key.",
  },
  {
    label: "Honest by construction",
    body: "Unknown is a first-class state. Incidents are published even when zero users were affected.",
  },
  {
    label: "Verifiable, not vouched",
    body: "Receipts replay byte-exact. Every transition carries its evidence. Optional on-chain anchoring for severe transitions.",
  },
  {
    label: "One operator, in public",
    body: "Solo-built, working in the open: the commit feed below is live from main.",
  },
];

export default async function AboutPage() {
  const entries = await getRecentCommits(3);

  return (
    <main className={cn("pegana-v2", switzerV2.variable, geistMonoV2.variable)}>
      <PageHeroV2
        eyebrow="About"
        h1={
          <>
            A peg watchdog you can <span className="v2-iri-text">read.</span>
          </>
        }
        maxWidthCh={20}
        lede="Open methodology, one operator, the same thresholds for everyone."
      />

      <div className="mx-auto max-w-[880px] px-5 pb-32 sm:px-8">
        <div className="v2-in-prose max-w-[640px]">
          {MANIFESTO.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>

        <hr className="v2-in-hr" />
        <h2 className="mb-1.5 text-[26px] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--v2-text)]">
          A peg-risk oracle other protocols can read.
        </h2>
        <p className="v2-in-prose max-w-[640px]">
          Pegana doesn&apos;t just alert humans. It&apos;s a public signal other
          contracts and platforms consume.
        </p>
        <ListRowsV2 label="Pegana at a glance">
          {ORACLE_READERS.map((r) => (
            <ListRow key={r.who} columns="170px 1fr">
              <b className="font-medium">{r.who}</b>
              <span className="text-[14.5px] text-[var(--v2-body)]">
                {r.what}
              </span>
            </ListRow>
          ))}
        </ListRowsV2>

        <hr className="v2-in-hr" />
        <div className="v2-in-facts">
          {FACTS.map((f) => (
            <div key={f.label} className="v2-in-fact">
              <b>{f.label}</b>
              <span>{f.body}</span>
            </div>
          ))}
        </div>

        <hr className="v2-in-hr" />
        <AboutNowWidget entries={entries} />

        <hr className="v2-in-hr" />
        <h2
          id="contact"
          className="mb-1.5 text-[26px] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--v2-text)]"
        >
          Get in touch.
        </h2>
        <p className="v2-in-prose max-w-[640px]">
          Issues, partnership asks, the occasional &quot;why is X
          drifting&quot;.{" "}
          <b className="font-medium text-[var(--v2-text)]">Email works best.</b>
        </p>
        <div className="mt-6 flex flex-wrap gap-3.5">
          <PillPrimary href="mailto:rafael@pegana.xyz">
            rafael@pegana.xyz
          </PillPrimary>
          <PillGhost href="https://x.com/PeganaHQ" external>
            @PeganaHQ
          </PillGhost>
        </div>
      </div>
    </main>
  );
}
