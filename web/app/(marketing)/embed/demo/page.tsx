import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/page-metadata";
import Link from "@/components/atoms/intent-link";
import { cn } from "@/lib/utils/cn";
import { switzerV2, geistMonoV2 } from "@/app/fonts/v2-fonts";
import { PageHeroV2 } from "@/components/organisms/v2/inner/page-hero-v2";
import { CodeBlockV2 } from "@/components/organisms/v2/inner/code-block-v2";
import { PillGhost } from "@/components/organisms/v2/shared";
import { siteOrigin } from "@/lib/seo/site-origin";

// Wave 11M.3 — /embed/demo showcase page.
//
// Five live embeds rendered in both supported patterns so partners can copy
// the exact snippet they'll paste. Sister of /embed (the configurator) and
// /embed/badge/[symbol] (the richer iframe). This page focuses on the
// minimalist /embed.js + /embed/[asset] pair.
//
// Re-platformed onto V5 (Wave 2B, 2026-07-16): PageHeroV2 header,
// CodeBlockV2 snippet panels, v2 tokens throughout — matches /embed, which
// now links forward here.

export const metadata: Metadata = pageMetadata({
  title: "Embed showcase",
  description:
    "Live <script> and <iframe> embeds across 5 representative Solana assets.",
  path: "/embed/demo",
});

const SHOWCASE_ASSETS = ["USDe", "JupUSD", "jitoSOL", "hyUSD", "USDS"];

const SITE_URL = siteOrigin();

export default function EmbedDemoPage() {
  return (
    <main className={cn("pegana-v2", switzerV2.variable, geistMonoV2.variable)}>
      <PageHeroV2
        eyebrow="Embed showcase"
        h1="Five assets. Two snippets each. Live."
        maxWidthCh={22}
        lede={
          <>
            Both patterns query the same /v1/assets/&lt;asset&gt;/state endpoint
            and refresh every 60s. The script pattern lets the badge inherit
            host typography; the iframe pattern sandboxes it.{" "}
            <Link
              href="/embed"
              className="underline-offset-2 hover:text-[var(--v2-text)] hover:underline"
            >
              Configure a custom badge →
            </Link>
          </>
        }
      />

      <div className="mx-auto max-w-[1080px] px-5 pb-24 sm:px-8 sm:pb-32">
        <section className="space-y-12">
          {SHOWCASE_ASSETS.map((asset) => (
            <article
              key={asset}
              className="border-t border-[var(--v2-line)] pt-8"
            >
              <header className="mb-6 flex items-baseline justify-between gap-4">
                <h2 className="font-mono text-[14px] uppercase tracking-[0.1em] text-[var(--v2-text)]">
                  {asset}
                </h2>
                <Link
                  href={`/asset/${asset}`}
                  className="font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--v2-dim)] underline-offset-2 hover:text-[var(--v2-text)] hover:underline"
                >
                  full page ↗
                </Link>
              </header>

              <div className="grid gap-8 lg:grid-cols-2">
                <PanelV2
                  label="<script> pattern (inherits host fonts)"
                  codeLabel="install.html"
                  snippet={`<script src="${SITE_URL}/embed.js" data-asset="${asset}"></script>`}
                >
                  <ScriptEmbed asset={asset} />
                </PanelV2>

                <PanelV2
                  label="<iframe> pattern (sandboxed)"
                  codeLabel="embed.html"
                  snippet={`<iframe src="${SITE_URL}/embed/${asset}" width="280" height="40" loading="lazy" title="Pegana ${asset}"></iframe>`}
                >
                  <iframe
                    src={`/embed/${asset}`}
                    width={280}
                    height={40}
                    loading="lazy"
                    title={`Pegana ${asset}`}
                    className="border-0"
                  />
                </PanelV2>
              </div>
            </article>
          ))}
        </section>

        <section className="mt-20 grid gap-8 border-t border-[var(--v2-line)] pt-10 sm:grid-cols-2">
          <div>
            <h2 className="text-[20px] font-medium tracking-[-0.02em] text-[var(--v2-text)]">
              When to use which
            </h2>
            <ul className="mt-3 space-y-2 text-[14px] leading-relaxed text-[var(--v2-muted)]">
              <li>
                <span className="text-[var(--v2-text)]">script</span> - docs
                sites, blog posts, dashboards with their own design system; the
                badge picks up your font and dark/light palette.
              </li>
              <li>
                <span className="text-[var(--v2-text)]">iframe</span> - partner
                pages where you want strict isolation, or static-site builders
                that disallow inline scripts.
              </li>
            </ul>
          </div>
          <div>
            <h2 className="text-[20px] font-medium tracking-[-0.02em] text-[var(--v2-text)]">
              No tracking, no bundle
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed text-[var(--v2-muted)]">
              Both patterns are dependency-free and emit zero analytics.
              Outbound links carry a utm_source so we can attribute referral
              traffic, nothing else.
            </p>
            <div className="mt-5">
              <PillGhost href="/embed">Configure a custom badge</PillGhost>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function PanelV2({
  label,
  codeLabel,
  snippet,
  children,
}: {
  label: string;
  codeLabel: string;
  snippet: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="font-mono text-[12px] uppercase tracking-[0.1em] text-[var(--v2-dim)]">
        {label}
      </div>
      <div className="flex min-h-[60px] items-center rounded-[14px] border border-[var(--v2-line)] bg-[var(--v2-panel)] px-4 py-3">
        {children}
      </div>
      <CodeBlockV2 label={codeLabel} code={snippet} />
    </div>
  );
}

// Server-rendered placeholder + client-side <script> loader. The plain
// <span> is the mount point and the <script> tag fetches state. We render
// the script inline via dangerouslySetInnerHTML so React doesn't dedupe it
// (one per asset). For SSR, the loader script is a no-op until hydration.
function ScriptEmbed({ asset }: { asset: string }) {
  const src = `${SITE_URL.replace(/\/$/, "")}/embed.js`;
  return (
    <>
      {/* The actual loader. Using a normal <script> tag keeps it idiomatic
          for the consumer documentation we're showing in the snippet. */}
      <script async src={src} data-asset={asset} suppressHydrationWarning />
      {/* If JS is disabled, surface a graceful fallback so the panel never
          looks broken. */}
      <noscript>
        <span className="font-mono text-[12px] text-[var(--v2-muted)]">
          {asset} - enable JavaScript to load live state
        </span>
      </noscript>
    </>
  );
}
