"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import type { AssetClass } from "@/lib/api/types";
import { monogramInitials, classTint } from "@/lib/token-icons/monogram";

interface TokenIconProps {
  /** SPL mint — selects the vendored file `/tokens/{mint}.webp`. */
  mint: string;
  /** Used for the monogram initials and the accessible label. */
  symbol: string;
  /** Tints the monogram fallback by asset family. */
  klass?: AssetClass;
  /** Rendered px (square). Default 24. */
  size?: number;
  className?: string;
  /** Override the accessible label (default `${symbol} logo`). */
  alt?: string;
  /** When the symbol text sits adjacent (the common case) keep the icon out of
   *  the a11y tree to avoid a duplicate announcement. Default true. */
  decorative?: boolean;
  /** Image loading hint — eager for above-the-fold (asset hero). Default lazy. */
  loading?: "lazy" | "eager";
  /**
   * Opts this icon into the cross-route shared-element morph, so a row's mark
   * grows into the asset hero's mark instead of one vanishing while the other
   * appears.
   *
   * ⚠️ A view-transition name must be UNIQUE within the document. jitoSOL can
   * legitimately render four times on `/dashboard` (board row, spread tape,
   * market feed, peer comparison) and a duplicate name makes the browser drop
   * the whole transition, not just this pair. So pass it from the page's
   * PRIMARY list row and from the asset hero only. Use `assetMorphName()` to
   * build it, never a hand-written string.
   */
  morphName?: string;
}

/**
 * The one place the morph name is spelled. Both sides of the pair must produce
 * a byte-identical string or the browser silently falls back to a crossfade,
 * which looks like "the animation just doesn't work" and is very hard to spot.
 */
export function assetMorphName(symbol: string): string {
  return `asset-mark-${symbol.toLowerCase()}`;
}

export function TokenIcon({
  mint,
  symbol,
  klass,
  size = 24,
  className,
  alt,
  decorative = true,
  loading = "lazy",
  morphName,
}: TokenIconProps) {
  const [failed, setFailed] = useState(false);
  const tint = classTint(klass);

  const wrapperA11y = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": alt ?? `${symbol} logo` } as const);

  return (
    <span
      {...wrapperA11y}
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2",
        className,
      )}
      style={{
        width: size,
        height: size,
        // Lifts this element out of the page snapshot on both sides of a
        // navigation, so the browser animates between its two boxes instead of
        // fading one out and another in. Plain CSS: no React feature involved.
        viewTransitionName: morphName,
        boxShadow: failed
          ? `inset 0 0 0 1px ${tint}66`
          : "inset 0 0 0 1px rgba(255,255,255,0.14)",
      }}
    >
      {failed ? (
        <span
          className="font-mono font-semibold leading-none"
          style={{
            fontSize: Math.round(size * 0.38),
            color: tint,
            letterSpacing: "-0.02em",
          }}
        >
          {monogramInitials(symbol)}
        </span>
      ) : (
        <img
          src={`/tokens/${mint}.webp`}
          width={size}
          height={size}
          alt=""
          loading={loading}
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
