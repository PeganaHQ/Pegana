import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/page-metadata";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { switzerV2, geistMonoV2 } from "@/app/fonts/v2-fonts";
import { PageHeroV2 } from "@/components/organisms/v2/inner/page-hero-v2";

// V5 re-platform (W2 gap-closer, 2026-07-16): last pre-V2 marketing page —
// ported onto the `.pegana-v2` inner-page vocabulary (PageHeroV2 + the
// `.v2-in-prose` article system from app/(marketing)/v2.css), same pattern
// as about/methodology/status. Content is verbatim; only the presentation
// moved — the "Last updated" stamp now lives in the hero's mono meta row
// (the slot every other V5 inner page uses for exactly this), not inline
// in the lede paragraph.

export const metadata: Metadata = pageMetadata({
  title: "Privacy",
  description:
    "What Pegana collects, what it doesn't, and how to get it deleted.",
  path: "/privacy",
});

const LAST_UPDATED = "August 3, 2026";

const SECTIONS: Array<{ title: string; body: ReactNode }> = [
  {
    title: "Website (pegana.xyz)",
    body: (
      <>
        The dashboard, asset detail pages, and methodology docs are served as
        static or server-rendered HTML. We don&apos;t set any analytics cookies
        or embed third-party tracking pixels. The following providers process
        visitor or service data as part of normal operation: <b>Hetzner</b>{" "}
        (backend hosting), <b>Vercel</b> (web hosting + analytics),{" "}
        <b>Sentry</b> (error monitoring), and <b>Cloudflare R2</b> (backup
        storage). Standard server logs (IP, user-agent, requested path, response
        code) are retained for 30 days for abuse investigation and discarded
        afterwards.
      </>
    ),
  },
  {
    title: "API + WebSocket (/v1/*)",
    body: (
      <>
        Every API request is logged the same way as the website. We rate-limit
        by IP to keep the service responsive. That rate-limit bucket lives in
        memory and resets when the process restarts. No request body inspection,
        no per-key analytics.
      </>
    ),
  },
  {
    title: "Third parties we talk to",
    body: (
      <>
        Pegana pulls public data from Pyth, Sanctum, Jupiter, DexScreener,
        DefiLlama, and Solana RPC providers. Those calls don&apos;t carry any
        information about you, they&apos;re server-to-server requests asking
        for on-chain or oracle data.
      </>
    ),
  },
  {
    title: "Storage and security",
    body: (
      <>
        Operational data lives in Postgres. Backups go to a private Cloudflare
        R2 bucket. Both are encrypted at rest. Sentry receives backend error
        telemetry only. No request bodies or PII are sent. Browser-side Sentry
        Replay is not enabled.
      </>
    ),
  },
  {
    title: "Data retention",
    body: (
      <>
        Server logs are retained for 30 days. Backups are retained for 30 days
        in Cloudflare R2. Sentry events are retained per Sentry&apos;s default
        retention period of 90 days; no PII is sent to Sentry.
      </>
    ),
  },
  {
    title: "Children",
    body: (
      <>
        The service is not directed at children under 13. If you believe a minor
        has submitted data to us, contact the email above and we will remove the
        record.
      </>
    ),
  },
  {
    title: "Changes",
    body: (
      <>
        If we ever expand what we collect, the new policy ships before the new
        collection does. The <b>Last updated</b> date at the top of this page is
        the source of truth.
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <main className={cn("pegana-v2", switzerV2.variable, geistMonoV2.variable)}>
      <PageHeroV2
        eyebrow="Privacy"
        h1="What we collect. Almost nothing."
        maxWidthCh={24}
        lede="Every page is public and needs no account. We don't run ads, sell data, or fingerprint you."
        meta={[`last updated ${LAST_UPDATED}`]}
      />

      <div className="mx-auto max-w-[880px] px-5 pb-32 sm:px-8">
        {SECTIONS.map((s, i) => (
          <div key={s.title}>
            {i > 0 && <hr className="v2-in-hr" />}
            <h2 className="mb-4 text-[26px] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--v2-text)]">
              {s.title}
            </h2>
            <p className="v2-in-prose">{s.body}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
