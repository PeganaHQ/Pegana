"use client";

import { useState } from "react";
import { displaySymbol } from "@/lib/asset/display-symbol";
import { holderSignedPct } from "@/lib/api/format";

const SITE = "https://www.pegana.xyz";

/** Shared copy-to-clipboard state + handler used by both the full pill row and
 *  the compact icon button. Returns the latest `copied` flag and a `copy()` to
 *  invoke on click. */
function useCopyPermalink(symbol: string) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(assetShareUrl(symbol));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — no-op; the X link still works */
    }
  }
  return { copied, copy };
}

/** Outline link/chain glyph for the compact share entry (sharp, mono geometry —
 *  brand.md). `aria-hidden`; the button supplies the accessible name. */
function IconLink({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      className="inline-block shrink-0"
    >
      <path d="M6 8 L8 6" />
      <path d="M5 9 L3.5 10.5 a2.12 2.12 0 0 1 -3 -3 L2 6" />
      <path d="M9 5 L10.5 3.5 a2.12 2.12 0 0 1 3 3 L12 8" />
    </svg>
  );
}

/** Canonical shareable permalink for an asset. */
export function assetShareUrl(symbol: string): string {
  return `${SITE}/asset/${encodeURIComponent(symbol)}`;
}

/** Share-card PNG route URL (vertical 4:5 branded card, download or link). */
export function assetShareCardUrl(symbol: string): string {
  return `${SITE}/asset/${encodeURIComponent(symbol)}/share-card`;
}

/**
 * Tweet copy: the live read, in the same holder-signed convention the page
 * prints (`holderSignedPct` negates the raw `reconcileBps` bps, so a discount
 * reads as `−`). Degrades to whatever is known: state only, spread only, or the
 * neutral fallback. Never invents a number.
 */
export function assetTweetText(
  symbol: string,
  state?: string | null,
  bps?: number | null,
): string {
  const shown = displaySymbol(symbol);
  const pretty = state ? state.replace("_", " ").toLowerCase() : null;
  const spread = bps == null ? null : holderSignedPct(bps);
  if (pretty && spread) return `${shown} is ${pretty}. Spread ${spread}.`;
  if (pretty) return `${shown} is ${pretty}.`;
  if (spread) return `${shown}. Spread ${spread}.`;
  return `${shown}; live peg-risk read`;
}

/**
 * X (Twitter) web-intent href. The permalink rides the `url` param (X appends
 * it after the text), so the copy itself stays short and readable.
 */
export function assetTweetHref(
  symbol: string,
  state?: string | null,
  bps?: number | null,
): string {
  const p = new URLSearchParams({
    text: assetTweetText(symbol, state, bps),
    url: assetShareUrl(symbol),
    via: "PeganaHQ",
  });
  return `https://x.com/intent/tweet?${p.toString()}`;
}

// Three ghost pills (brand.md: rounded-full for actions, ease-default hover).
// "Share on X" is a plain intent link: one click, no side effect. It used to
// try `navigator.share` with the PNG first, which on desktop (no file Web Share)
// silently downloaded an image and THEN opened the intent, and left the user to
// re-attach the file in X. The "Card" pill is the honest download; "Copy link"
// copies the permalink. The OG card + per-asset metadata (layout.tsx) make the
// permalink unfurl into a branded peg-state card.
export function ShareButton({
  symbol,
  state,
  bps,
  className,
}: {
  symbol: string;
  state?: string | null;
  /** Raw `reconcileBps`-convention bps; negated for display by the helpers. */
  bps?: number | null;
  className?: string;
}) {
  const { copied, copy } = useCopyPermalink(symbol);

  const pill =
    "inline-flex items-center gap-2 rounded-full border border-outline px-4 py-2 text-[13px] " +
    "transition-colors duration-300 ease-default hover:border-text hover:bg-text/[0.04] " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-muted";

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <a
        href={assetTweetHref(symbol, state, bps)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share on X"
        className={`${pill} text-text`}
      >
        <span aria-hidden="true">Share on X</span>
      </a>
      <a
        href={assetShareCardUrl(symbol)}
        download
        aria-label="Download share card"
        className={`${pill} text-text`}
      >
        <span aria-hidden="true" className="inline-flex items-center gap-1.5">
          <svg
            width="13"
            height="13"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="square"
            strokeLinejoin="miter"
            aria-hidden="true"
            className="inline-block shrink-0"
          >
            <path d="M7 1.5 V9.5" />
            <path d="M4 6.5 L7 9.5 L10 6.5" />
            <path d="M2 11.5 V12.5 H12 V11.5" />
          </svg>
          Card
        </span>
      </a>
      <button
        type="button"
        onClick={copy}
        // Stable accessible name: the visible label swaps to "Copied" but the
        // aria-label stays fixed so the button's name never changes under the
        // user. The confirmation is announced via the sr-only status region.
        aria-label="Copy link"
        className={`${pill} text-text-muted hover:text-text`}
      >
        <span aria-hidden="true">{copied ? "Copied" : "Copy link"}</span>
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "Link copied" : ""}
      </span>
    </div>
  );
}

// Compact single-glyph copy-link control for tight surfaces (mobile sticky
// header) where the full two-pill row would not fit. Ghost icon button, sharp
// brand geometry, stable accessible name + sr-only status (same a11y contract
// as the full row's Copy-link button).
export function ShareIconButton({
  symbol,
  className,
}: {
  symbol: string;
  className?: string;
}) {
  const { copied, copy } = useCopyPermalink(symbol);
  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy link"
        className={`inline-flex h-8 w-8 items-center justify-center border border-outline transition-colors duration-300 ease-default hover:border-text hover:bg-text/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-muted ${
          copied ? "text-text" : "text-text-muted hover:text-text"
        } ${className ?? ""}`}
      >
        <IconLink />
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "Link copied" : ""}
      </span>
    </>
  );
}
