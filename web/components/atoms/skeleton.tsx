import { cn } from "@/lib/utils/cn";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      // `.skeleton-sheen` (globals.css) is the diagonal sweep that says
      // "actively loading" rather than "this box is empty". It already existed
      // and was wired into exactly two surfaces, while every other loading
      // state in the app used this atom and sat perfectly still. Moving it here
      // is one edit that reaches all of them. The global reduced-motion guard
      // zeroes the animation and leaves the static fill, which is why this does
      // not need its own media query.
      className={cn(
        "skeleton-sheen border border-hairline bg-surface-1/30",
        className,
      )}
    />
  );
}

export function SkeletonRow() {
  return (
    <div className="grid grid-cols-[110px_1fr_1fr_110px_120px] items-baseline gap-4 border-b border-hairline px-4 py-4">
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-3 w-14 justify-self-end" />
      <Skeleton className="h-4 w-20 justify-self-end" />
    </div>
  );
}
