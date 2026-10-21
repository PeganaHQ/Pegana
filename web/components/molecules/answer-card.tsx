import Link from "@/components/atoms/intent-link";
import { TokenIcon } from "@/components/atoms/token-icon";
import { IconArrowRight } from "@/components/atoms/icon-arrow-right";
import { cardSurface } from "@/components/atoms/surface-card";
import { cn } from "@/lib/utils/cn";
import { displaySymbol } from "@/lib/asset/display-symbol";
import type { AssetClass } from "@/lib/api/types";

// One of the Command Center's two always-meaningful answer-cards (Closest
// to its band / Most volatile 24h — MASTER FASE 3/4 killer verdict: trimmed
// from the original candidate set to exactly these two because both always
// have a #1, on every calm day, with zero fabricated data). Whole card is a
// single Link to the asset page — no hover-peek, click straight through.
//
// Equal-height siblings sit in a `grid` (grid's default `align-items:
// stretch` already equalizes the two cards' outer height — confirmed
// 231.5px/231.5px in the craft audit). What wasn't equalized was the
// CONTENT: the shorter card (no band gauge, just a jitter caption + spark)
// left ~28px of dead air below its sparkline while the taller card's stack
// filled the box exactly. `flex h-full flex-col` + a `flex-1 justify-end`
// wrapper around the gauge/sparkline slot pushes that slack into the gap
// ABOVE the slot instead, so both cards' sparklines land on the same
// baseline near the bottom edge regardless of how much content precedes them.
export function AnswerCard({
  eyebrow,
  href,
  symbol,
  name,
  mint,
  klass,
  metric,
  metricClassName,
  children,
  className,
}: {
  eyebrow: string;
  href: string;
  symbol: string;
  name: string;
  mint: string;
  klass: AssetClass;
  /** The headline metric for this card, e.g. "0.38% away" or "±0.12%". */
  metric: string;
  metricClassName?: string;
  /** Gauge / sparkline stack rendered below the metric. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        // Card hover DNA measured off tokens.xyz (walk.md §1.3/§3): ring-2
        // (not a new shadow — Tailwind's `ring` IS box-shadow, so one
        // transitioned property list covers it) + active:scale-[0.98] on
        // click, 150ms ease-out, reduced-motion-safe. No lift/rotate.
        cardSurface({
          radius: 16,
          // These two sit directly on the canvas with a hairline outline and
          // no fill. Giving them `bg-surface-1` would be a design change, not
          // a refactor.
          background: "none",
          className: "group flex h-full flex-col p-4 sm:p-5",
        }),
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-caption">
          {eyebrow}
        </span>
        <IconArrowRight
          size={11}
          className="text-text-muted/40 transition-colors duration-200 group-hover:text-text-muted"
        />
      </div>

      <div className="mt-3 flex min-w-0 items-center gap-2">
        <TokenIcon
          mint={mint}
          symbol={displaySymbol(symbol)}
          klass={klass}
          size={22}
        />
        <span className="text-[15px] font-medium text-text">
          {displaySymbol(symbol)}
        </span>
        <span className="truncate text-[12px] text-text-muted">{name}</span>
      </div>

      <div
        className={cn(
          "mt-2 font-mono text-[22px] font-medium tabular-nums",
          metricClassName ?? "text-text",
        )}
      >
        {metric}
      </div>

      {children && (
        <div className="mt-3.5 flex flex-1 flex-col justify-end">
          {children}
        </div>
      )}
    </Link>
  );
}
