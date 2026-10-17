import { headers } from "next/headers";

/**
 * Nonce-carrying JSON-LD block. Server Components only.
 *
 * THE NONCE IS MANDATORY. The site ships an ENFORCING CSP whose `script-src`
 * carries `'strict-dynamic'` and no `'unsafe-inline'`. `'strict-dynamic'` makes
 * browsers ignore `'self'` and every host-source expression for scripts, so a
 * matching nonce is the ONLY way an inline `<script>` survives. An un-nonced
 * block is dropped outright and additionally spams `/api/csp-report`.
 *
 * (`application/ld+json` is a data block rather than executable script, and some
 * browsers do not enforce `script-src` on non-executable types. Do not rely on
 * that — match the site-wide block in `app/layout.tsx`.)
 *
 * `headers()` is readable only from a Server Component, which is why structured
 * data cannot be emitted from any `"use client"` page. The `?? undefined`
 * fallback keeps prerender and CI from throwing when the proxy has not stamped
 * `x-nonce` — it skips RSC prefetches (see `web/proxy.ts`).
 */
export async function JsonLd({ data }: { data: Record<string, unknown> }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      // Escape `<` so a `</script>` inside the data cannot break out of the
      // tag. `<` is valid JSON — parsers read it identically.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
