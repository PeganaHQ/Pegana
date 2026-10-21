"use client";

import NextLink from "next/link";
import { forwardRef, useState, type ComponentProps } from "react";

type NextLinkProps = ComponentProps<typeof NextLink>;

/**
 * `next/link` with prefetch on user intent only. Every internal link in the
 * app goes through this wrapper (an ESLint rule bans importing `next/link`
 * elsewhere).
 *
 * Why: every page is dynamically rendered (the root layout reads the
 * per-request CSP nonce), so each viewport prefetch is a Vercel function
 * invocation. Measured on production 2026-10-21 in a clean browser: the landing
 * page fired 17 RSC prefetches in its first 12 seconds, /dashboard 23 and
 * /asset/jitoSOL 18. Each prefetched route was fetched twice under two
 * different `_rsc` hashes. That is more than half the
 * function invocations of a page view, nearly all of them for links the
 * visitor never clicked.
 *
 * Now a link prefetches only when the pointer enters it, it gets keyboard
 * focus, or a touch starts on it. That is about 100-300 ms before the click,
 * so the navigation still starts warm. `prefetch={null}` restores the
 * framework's default behavior at that point.
 *
 * A caller that passes `prefetch` explicitly keeps full control.
 */
export const IntentLink = forwardRef<HTMLAnchorElement, NextLinkProps>(
  function IntentLink(
    { prefetch, onMouseEnter, onFocus, onTouchStart, ...rest },
    ref,
  ) {
    const [intent, setIntent] = useState(false);
    const explicit = prefetch !== undefined;
    return (
      <NextLink
        ref={ref}
        {...rest}
        prefetch={explicit ? prefetch : intent ? null : false}
        onMouseEnter={(e) => {
          if (!intent) setIntent(true);
          onMouseEnter?.(e);
        }}
        onFocus={(e) => {
          if (!intent) setIntent(true);
          onFocus?.(e);
        }}
        onTouchStart={(e) => {
          if (!intent) setIntent(true);
          onTouchStart?.(e);
        }}
      />
    );
  },
);

export default IntentLink;
