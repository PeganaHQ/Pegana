import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Analytics } from "@vercel/analytics/next";
import { MotionProvider } from "@/components/atoms/motion-provider";
import { ServiceWorkerRegistrar } from "@/components/atoms/service-worker";
import { GlossaryProvider } from "@/lib/store/glossary-context";
import { GlossarySheet } from "@/components/molecules/glossary-sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { SwrConfigProvider } from "@/components/providers/swr-config-provider";
import { switzerV2, geistMonoV2 } from "@/app/fonts/v2-fonts";
import "./globals.css";
import { cn } from "@/lib/utils/cn";
import { BRAND_CANVAS } from "@/lib/brand/canvas";

const siteUrl = "https://www.pegana.xyz";
const siteTitle = "Pegana: peg-risk oracle for Solana";
const siteDescription =
  "Peg-risk oracle for Solana. Real-time intrinsic-vs-market spread for LSTs, stablecoins and yield-bearing tokens.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: siteTitle,
    // "·" not ".": a period between a page name and a brand reads as a typo,
    // and it is the one separator no convention uses. The middle dot is already
    // the product's own separator in 218 places ("Stables · fiat",
    // "Page 1 of 7 · 67 assets"), so titles now match the interface. Not a pipe
    // — a 21-day split test found dashes/dots outperform it on organic clicks —
    // and not an em-dash, which tests/unit/design/em-dash-guard.test.ts bans.
    template: "%s · Pegana",
  },
  description: siteDescription,
  applicationName: "Pegana",
  authors: [{ name: "Rafael Souza", url: "https://x.com/PeganaHQ" }],
  creator: "Rafael Souza",
  publisher: "Pegana",
  category: "finance",
  formatDetection: { telephone: false, email: false, address: false },
  keywords: [
    "Solana",
    "Solana DeFi",
    "depeg",
    "peg monitor",
    "peg-risk oracle",
    "risk oracle",
    "intrinsic value",
    "LST",
    "LST monitor",
    "stablecoin",
    "synthetic asset",
    "yield-bearing token",
    "CDP",
    "DeFi alerts",
    "MCP",
    "Sanctum",
    "Jito",
    "Jupiter",
    "Hylo",
    "Pyth",
  ],
  alternates: {
    // No root `canonical` here: a hardcoded `"/"` would canonicalize EVERY page
    // (/about, /methodology, /audit, …) to the homepage, so search engines treat
    // them as duplicates and don't rank them. Each page is self-canonical via its
    // own resolved URL (metadataBase); a page can set its own `alternates.canonical`
    // when it needs one. The feed `types` below are correctly root-level.
    types: {
      // AC50 — the two Trust-Layer Atom feeds must be discoverable from the
      // root `<head>` so feed readers and crawlers can autodetect them
      // alongside the existing RSS feed.
      "application/atom+xml": [
        { url: "/audit.xml", title: "Pegana. Trust Layer Receipts" },
        { url: "/calibration.xml", title: "Pegana. Methodology Calibration" },
      ],
      "application/rss+xml": [
        { url: "/feed/events.xml", title: "Pegana: depeg events" },
      ],
    },
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "Pegana",
    title: siteTitle,
    description: siteDescription,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    site: "@PeganaHQ",
    creator: "@PeganaHQ",
    title: siteTitle,
    description: siteDescription,
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      {
        url: "/android-chrome-192x192.png",
        type: "image/png",
        sizes: "192x192",
      },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  // Served by app/manifest.ts (a typed MetadataRoute), not the old static
  // public/site.webmanifest. Next injects the <link rel="manifest"> itself.
  //
  // iOS 26 opens any home-screen site as a web app even without a manifest, but
  // these three still matter: `capable` keeps older iOS in standalone,
  // `black-translucent` lets the page paint under the status bar (which is what
  // `viewport-fit=cover` plus the safe-area padding across the shell is for),
  // and `title` stops the home-screen label falling back to the 34-char
  // marketing <title>.
  appleWebApp: {
    capable: true,
    title: "Pegana",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: BRAND_CANVAS,
  colorScheme: "dark",
  // `viewport-fit=cover` lets content extend under the notch / home-indicator
  // and is REQUIRED for `env(safe-area-inset-*)` to resolve to non-zero values.
  // Without it the safe-area padding added across the mobile shell is a no-op.
  viewportFit: "cover",
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Pegana",
  description:
    "Peg-risk oracle for Solana. Measures the spread between intrinsic value and market price for every monitored LST, stablecoin and yield-bearing token, and publishes the state transition over REST, WebSocket, and MCP.",
  url: siteUrl,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  license: "https://github.com/PeganaHQ/ReplayCLI/blob/main/LICENSE",
  author: {
    "@type": "Person",
    name: "Rafael Souza",
    url: "https://x.com/PeganaHQ",
  },
  // The publishing entity, distinct from the author. Search engines and LLM
  // crawlers use this to resolve "who is behind Pegana" — pointing it at the
  // GitHub org (rather than a single repo) is what makes the open-source side
  // discoverable as an organisation instead of one stray project.
  publisher: {
    "@type": "Organization",
    name: "PeganaHQ",
    url: siteUrl,
    sameAs: ["https://github.com/PeganaHQ", "https://x.com/PeganaHQ"],
  },
  sameAs: [
    "https://x.com/PeganaHQ",
    "https://github.com/PeganaHQ",
    "https://github.com/PeganaHQ/ReplayCLI",
  ],
};

// RootLayout is async so it can call `headers()` (Next.js 16 async API) to
// read the `x-nonce` value set by proxy.ts. This makes the root layout
// dynamically rendered — all pages that use this layout will render on every
// request rather than being statically generated. For a monitoring/dashboard
// app that already fetches live data, this is the correct behavior.
//
// Pages that were previously statically optimized (e.g. /privacy) will flip
// to dynamic. Legacy doc redirects (/docs, /concepts, etc.) are handled in
// vercel.json + next.config.ts and do not render through this layout, so they
// are unaffected. This is acceptable for the Report-Only phase; re-evaluate
// when enforcing.
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Read the per-request nonce set by proxy.ts. Falls back to undefined when
  // running in a context where the proxy didn't fire (e.g. static prerender
  // in CI — this is safe because Report-Only CSP is a response header concern,
  // not a render concern; missing nonce just means inline scripts won't be
  // whitelisted, which is acceptable during Report-Only).
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className={cn(switzerV2.variable, geistMonoV2.variable, "font-sans")}
    >
      <body>
        <ThemeProvider
          attribute="data-theme"
          defaultTheme="dark"
          forcedTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
          nonce={nonce}
        >
          <script
            type="application/ld+json"
            nonce={nonce}
            // Escape `<` so a `</script>` in the data can't break out of the
            // JSON-LD tag (react-doctor: unsafe-json-in-html). `<` is valid
            // JSON — parsers read it identically.
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
            }}
          />
          <SwrConfigProvider>
            <MotionProvider>
              <TooltipProvider delayDuration={150}>
                <GlossaryProvider>
                  {/*
                    Skip link. Every page carries a FIXED floating nav, so a
                    keyboard user otherwise tabs through the whole nav on every
                    page load with no way out.

                    The LINK lives here because it must be the first focusable
                    element in <body>. Its TARGET deliberately does NOT — see
                    `SkipTarget`, rendered by each chrome-owning layout AFTER
                    the nav: (marketing)/layout.tsx, (app)/layout.tsx,
                    backtest/layout.tsx.

                    An earlier version put `id="main-content"` on this wrapper,
                    around `{children}`. That was a NO-OP: `{children}` IS the
                    group layout, and those layouts render the banner and nav as
                    their FIRST elements — so "skip to content" moved focus to a
                    point BEFORE the nav, and the next Tab went straight back
                    into it. A skip link has to target a node that comes after
                    the chrome, which means it can only be defined where the
                    chrome is.
                  */}
                  <a
                    href="#main-content"
                    className="sr-only rounded-b-md bg-surface-1 px-4 py-2 text-sm font-medium text-text outline-none focus:not-sr-only focus:absolute focus:left-4 focus:top-0 focus:z-[100] focus:ring-2 focus:ring-text"
                  >
                    Skip to content
                  </a>
                  <div className="relative z-[2]">{children}</div>
                  <GlossarySheet />
                </GlossaryProvider>
              </TooltipProvider>
            </MotionProvider>
          </SwrConfigProvider>
        </ThemeProvider>
        <ServiceWorkerRegistrar />
        <Analytics />
      </body>
    </html>
  );
}
