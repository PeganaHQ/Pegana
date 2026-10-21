import Link from "@/components/atoms/intent-link";
import { cardSurface } from "@/components/atoms/surface-card";
import { cn } from "@/lib/utils/cn";

// A glanceable stat-object for the dashboard verdict-hero: a labeled unit
// (closest-to-band, last-transition) instead of a run-on prose sentence. The
// whole object becomes a Link when `href` is present (e.g. the receipt).
export function VerdictStat({
  label,
  href,
  children,
  className,
}: {
  label: string;
  href?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const inner = (
    <>
      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-caption">
        {label}
      </span>
      <span className="mt-0.5 block truncate font-mono text-[13px] font-medium text-text">
        {children}
      </span>
    </>
  );
  const surfaceClassName = cn("block bg-surface-2/40 px-3 py-2", className);
  if (href) {
    return (
      <Link
        href={href}
        className={cardSurface({ radius: 14, className: surfaceClassName })}
      >
        {inner}
      </Link>
    );
  }
  return (
    <div
      className={cardSurface({
        radius: 14,
        interactive: false,
        className: surfaceClassName,
      })}
    >
      {inner}
    </div>
  );
}
