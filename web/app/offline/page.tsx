import Link from "@/components/atoms/intent-link";

import { pageMetadata } from "@/lib/seo/page-metadata";

// Bare title: the root layout's `%s · Pegana` template appends the brand.
// noindex because this document only ever renders from the service worker's
// offline fallback, and an indexed "we cannot verify a peg" page would be a
// terrible search result for the product.
export const metadata = pageMetadata({
  title: "Offline",
  description: "Pegana needs a connection to report a live peg state.",
  path: "/offline",
  noindex: true,
});

/**
 * The document the service worker serves when a navigation cannot reach the
 * network.
 *
 * It shows no numbers, on purpose. Every other surface in this app is built to
 * answer "is this asset still on its peg", and the only honest answer without a
 * connection is "I do not know right now". A cached spread here would look
 * exactly like a live one.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-caption">
        No connection
      </p>
      <h1 className="mt-4 max-w-[18ch] text-[28px] font-medium leading-[1.1] tracking-[-0.02em] text-text sm:text-[36px]">
        Pegana cannot verify a peg offline.
      </h1>
      <p className="mt-4 max-w-[46ch] text-[15px] leading-[1.6] text-text-body">
        Every state on this site is measured against live market and intrinsic
        values. Showing you the last ones we saw would look identical to showing
        you the current ones, so we show neither.
      </p>
      <Link
        href="/dashboard"
        data-cta="primary"
        className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-full bg-text px-6 py-3 font-mono text-[12px] uppercase tracking-[0.09em] text-canvas"
      >
        Try again
      </Link>
    </main>
  );
}
