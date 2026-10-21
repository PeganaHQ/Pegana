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

const LAST_UPDATED = "October 21, 2026";

// Every processor and retention claim below was checked against the code and
// config on 2026-10-21: web on Vercel (Web Analytics is cookieless), backend
// on a Hostinger VPS behind Caddy with no access log, Sentry SDK in the
// browser and server (ingestion currently rejected), docs on Mintlify, mail on
// Hostinger, WebSocket connects logged with the client IP (crates/api-rs
// src/ws.rs), REST requests not logged per request. Keep it that way: change this page in the same commit that
// changes a processor.
const SECTIONS: Array<{ title: string; body: ReactNode }> = [
  {
    title: "Website (www.pegana.xyz)",
    body: (
      <>
        The site needs no account and sets no analytics or advertising cookies.
        <b> Vercel</b> hosts it and receives each request (IP address, user
        agent, requested path) to serve and protect the site, and keeps its own
        short-lived request logs. We use <b>Vercel Web Analytics</b>, which
        counts page views without cookies. The news strip on the dashboard
        loads some thumbnails straight from <b>X</b> (pbs.twimg.com), so X sees
        the request for those images; CoinGecko article images are fetched
        through our own image proxy instead.
      </>
    ),
  },
  {
    title: "API + WebSocket (api.pegana.xyz)",
    body: (
      <>
        The API runs on a <b>Hostinger</b> virtual server. The rate limiter
        keeps a per-IP request counter in memory only; it is never written to
        disk and resets when the process restarts. The web server in front of
        the API keeps no access log, and REST requests are not logged one by
        one. The API does log the IP address of each WebSocket connection when
        it opens. No request body inspection, no per-key analytics.
      </>
    ),
  },
  {
    title: "Error monitoring",
    body: (
      <>
        The website and backend include <b>Sentry</b>&apos;s error-monitoring
        SDK. When an error report is sent it carries the page or endpoint, the
        error, and the browser and operating system, and Sentry may record the
        IP address the report came from. Session replay is not enabled. As of
        the date above, Sentry is rejecting our reports, so none are being
        stored.
      </>
    ),
  },
  {
    title: "Docs and email",
    body: (
      <>
        The documentation at docs.pegana.xyz is hosted by <b>Mintlify</b>,
        which processes those visits under its own policy. Email to a
        pegana.xyz address is handled by <b>Hostinger</b>&apos;s mail service.
      </>
    ),
  },
  {
    title: "Third parties we talk to",
    body: (
      <>
        Pegana pulls public data from Pyth, Sanctum, Jupiter, DexScreener,
        tokens.xyz, Kamino and Solana RPC providers including Helius. Those
        calls don&apos;t carry any information about you, they&apos;re
        server-to-server requests asking for on-chain, oracle or market data.
      </>
    ),
  },
  {
    title: "Storage and retention",
    body: (
      <>
        Operational data (prices, peg states, receipts) lives in Postgres on
        the same server; none of it is about visitors. Service logs rotate by
        size and are not archived, so they cover hours to a few days,
        including those WebSocket connection IPs. Offsite
        backups to a private <b>Cloudflare R2</b> bucket are planned but not
        running yet. Sentry keeps events for its default period (90 days)
        once ingestion works.
      </>
    ),
  },
  {
    title: "Children",
    body: (
      <>
        The service is not directed at children under 13. If you believe a minor
        has submitted data to us, contact{" "}
        <a href="mailto:rafael@pegana.xyz">rafael@pegana.xyz</a> and we will
        remove the record.
      </>
    ),
  },
  {
    title: "Changes",
    body: (
      <>
        If we ever expand what we collect, the new policy ships before the new
        collection does. The <b>Last updated</b> date at the top of this page is
        the source of truth. The code that does all of this is public at{" "}
        <a href="https://github.com/PeganaHQ/Pegana">github.com/PeganaHQ/Pegana</a>
        .
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
