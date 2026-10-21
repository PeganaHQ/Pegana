"use client";

import Link from "next/link";
import { BrandLockupV2 } from "@/components/organisms/v2/shared";

// DESIGN.md §5.7 - footer: logo + tagline, link columns, hairline, copyright +
// real X/GitHub SVG icons. This is the single sitewide footer (the old
// components/organisms/site-footer was retired in the V2 port).
//
// Kept deliberately narrow (3 columns, max 5 items each). The footer is a
// navigation summary, not an index: every entry here is a destination someone
// arrives at from any page. Surfaces that are still live but secondary
// (/compare, /events, /systemic, /backtest, /whats-new, /embed) are reachable
// from the nav, the dashboard, or a contextual link, so they do not earn a
// slot. A guard test (tests/unit/design/page-integrity.test.ts) asserts every
// href below resolves to a route that actually ships.
//
// Deliberately NOT here:
// - Telegram bot: removed from the product.
// - Webhooks: the user-facing webhook surface is gone from the API.
// - Embed widget: /embed still ships and is useful (an embeddable live peg
//   badge is a real distribution surface), but it is a secondary integration
//   playground; it is linked from /agents instead of taking a footer slot.

const ORG = "https://github.com/PeganaHQ";
const REPO = `${ORG}/ReplayCLI`;
const DOCS = "https://docs.pegana.xyz";

const COLUMNS: Array<{
  title: string;
  items: Array<{ href: string; label: string; external?: boolean }>;
}> = [
  {
    title: "product",
    items: [
      { href: "/dashboard", label: "Dashboard" },
      { href: "/assets", label: "Assets" },
      { href: "/lst", label: "LST directory" },
      { href: "/methodology", label: "Methodology" },
      { href: "/audit", label: "Audit log" },
    ],
  },
  {
    title: "developers",
    items: [
      { href: `${DOCS}/guides/rest-api`, label: "REST API" },
      { href: `${DOCS}/guides/websocket`, label: "WebSocket" },
      { href: `${DOCS}/guides/mcp`, label: "MCP for agents" },
      { href: REPO, label: "Replay CLI", external: true },
      { href: "/status", label: "Status" },
    ],
  },
  {
    title: "project",
    items: [
      { href: "/about", label: "About" },
      { href: "/faq", label: "FAQ" },
      { href: "/agents", label: "For agents" },
      { href: "/releases", label: "Verify a receipt" },
      { href: "mailto:rafael@pegana.xyz", label: "Contact" },
    ],
  },
];

export function FooterV2() {
  return (
    <footer className="relative z-[2] border-t border-[var(--v2-line)] bg-[var(--v2-bg)] pb-10 pt-16">
      <div className="mx-auto max-w-[1180px] px-6 sm:px-10">
        <div className="grid grid-cols-1 gap-8 max-[759px]:grid-cols-2 min-[760px]:max-[999px]:grid-cols-3 min-[1000px]:grid-cols-[1.6fr_1fr_1fr_1fr]">
          <div className="max-[759px]:col-span-2 min-[760px]:max-[999px]:col-span-3 min-[1000px]:col-span-1">
            <BrandLockupV2 gradientId="v2-footer-wave" chroma />
            <p className="mt-3 max-w-[32ch] text-[14px] leading-[1.6] text-[var(--v2-dim)]">
              Verifiable peg-risk infrastructure for Solana. Every verdict
              explainable, replayable, inspectable.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              {/* h3, not h4: marketing pages stop at h2, so an h4 here skipped a level
                  on every single page (verified on /about: h1 -> h2 -> h3 -> h2 ->
                  h4 x5). h3 is the correct next level under the page content. */}
              <h3 className="mb-3.5 font-mono text-[12px] uppercase tracking-[0.12em] text-[var(--v2-muted)] max-[759px]:mb-2.5">
                {col.title}
              </h3>
              {col.items.map((item) => (
                <Link
                  key={item.href + item.label}
                  href={item.href}
                  target={item.external ? "_blank" : undefined}
                  rel={item.external ? "noreferrer" : undefined}
                  className="block py-[5px] text-sm text-[var(--v2-muted)] transition-colors duration-200 hover:text-[var(--v2-text)] max-[759px]:py-2.5 max-[759px]:text-[15px]"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-2.5 border-t border-[var(--v2-line)] pt-[22px] font-mono text-[12px] text-[var(--v2-dim)] max-[759px]:gap-[14px]">
          <span className="flex flex-wrap items-center gap-[18px]">
            <span>© {new Date().getFullYear()} Pegana. All rights reserved.</span>
            <Link
              href="/privacy"
              className="transition-colors duration-200 hover:text-[var(--v2-text)]"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="transition-colors duration-200 hover:text-[var(--v2-text)]"
            >
              Terms
            </Link>
          </span>
          <span className="flex gap-[22px]">
            <a
              href="https://x.com/PeganaHQ"
              target="_blank"
              rel="noreferrer"
              aria-label="X (Twitter)"
              className="inline-flex items-center text-[var(--v2-dim)] transition-colors duration-[250ms] ease-[var(--v2-ease)] hover:text-[var(--v2-text)] max-[759px]:p-2"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden
              >
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zM17.083 19.77h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            <a
              href={ORG}
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub"
              className="inline-flex items-center text-[var(--v2-dim)] transition-colors duration-[250ms] ease-[var(--v2-ease)] hover:text-[var(--v2-text)] max-[759px]:p-2"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden
              >
                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
              </svg>
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
