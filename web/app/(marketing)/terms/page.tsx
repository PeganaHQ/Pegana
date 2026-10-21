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
  title: "Terms",
  description: "The rules of using the dashboard, API, and MCP server.",
  path: "/terms",
});

const LAST_UPDATED = "October 21, 2026";

const SECTIONS: Array<{ title: string; body: ReactNode }> = [
  {
    title: "Not financial advice",
    body: (
      <>
        Every number on this site is a real-time measurement of the gap between
        what a token <em>should</em> be worth (intrinsic, derived from on-chain
        accounts or oracle redemption rates) and what someone is actually paying
        for it (market, from Jupiter or DexScreener). These measurements are
        useful inputs to your own analysis, not signals to buy or sell. We
        don&apos;t hold a position in any of the monitored assets and we
        don&apos;t want one. See the methodology page for the arithmetic.
      </>
    ),
  },
  {
    title: "No warranty",
    body: (
      <>
        The data can be wrong. An indexer can miss a publish, an oracle can
        publish a stale price, an RPC can return out-of-date account state. We
        do our best to flag that. The engine refuses Pyth readings older than
        its staleness window, the API surfaces an <code>updated_at</code>{" "}
        timestamp on every asset, and each transition carries the confidence
        label the snapshot was emitted under. But we make no
        representation that any single number is correct at the instant you look
        at it. Verify before acting.
      </>
    ),
  },
  {
    title: "API + rate limits",
    body: (
      <>
        The public API at <b>api.pegana.xyz</b> is open and unauthenticated. We
        rate-limit by IP to keep it healthy: 240 REST requests a minute per IP
        (see the RateLimit-Limit header) and 20
        open WebSocket connections per IP. If you want a higher quota, email
        the address at the bottom. We&apos;ll probably say yes if your use case
        is benign. Or run your own instance from the source (see below).
      </>
    ),
  },
  {
    title: "MCP server",
    body: (
      <>
        The MCP server is free and needs no API key. Every tool is provided as
        is, with no warranty, and results are informational only, not financial
        advice. We rate-limit by IP to keep it healthy.
      </>
    ),
  },
  {
    title: "Acceptable use",
    body: (
      <>
        Don&apos;t scrape the API in a way that degrades it for others.
        Don&apos;t attempt to bypass rate limits. Don&apos;t re-serve the hosted
        API under a different brand without attribution. If you build something
        on top of the API, a credit link is appreciated but not required. These
        rules are about the service we host; running your own copy of the code
        is covered by its license below.
      </>
    ),
  },
  {
    title: "Sanctions",
    body: (
      <>
        Users must not be located in sanctioned jurisdictions. Pegana may reject
        requests from sanctioned addresses.
      </>
    ),
  },
  {
    title: "Suspension",
    body: (
      <>
        Pegana may reject MCP requests, block addresses, or throttle clients for
        abuse, sanctions risk, or operational protection.
      </>
    ),
  },
  {
    title: "Source code + license",
    body: (
      <>
        All of Pegana is open source under the{" "}
        <a href="https://opensource.org/license/mit">MIT license</a>: the
        indexer, engine, API, web app, MCP server, methodology and verification
        types at{" "}
        <a href="https://github.com/PeganaHQ/Pegana">github.com/PeganaHQ/Pegana</a>
        , and the Replay CLI at{" "}
        <a href="https://github.com/PeganaHQ/ReplayCLI">
          github.com/PeganaHQ/ReplayCLI
        </a>
        . You can read, run, modify and self-host it under that license. The
        license covers the code; it does not let you present another service
        as Pegana or use the Pegana name and wordmark as your own brand.
      </>
    ),
  },
  {
    title: "Liability",
    body: (
      <>
        To the maximum extent permitted by law, Pegana and its operator
        aren&apos;t liable for trading losses, missed alerts, downtime, or any
        consequential damage from using the service. If you can&apos;t accept
        that, please don&apos;t use it.
      </>
    ),
  },
  {
    title: "Changes + contact",
    body: (
      <>
        Material changes to these terms ship at least 14 days before they take
        effect for existing users. The <b>Last updated</b> date at the top is
        the source of truth. Questions:{" "}
        <a href="mailto:rafael@pegana.xyz">rafael@pegana.xyz</a>.
      </>
    ),
  },
];

export default function TermsPage() {
  return (
    <main className={cn("pegana-v2", switzerV2.variable, geistMonoV2.variable)}>
      <PageHeroV2
        eyebrow="Terms"
        h1="Use it as information, not as advice."
        maxWidthCh={28}
        lede="Pegana's website, REST API, WebSocket feed, and MCP server are provided free. By using these services you agree to these terms."
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
