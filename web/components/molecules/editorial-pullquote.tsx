// Editorial pullquote — coral left bar magazine convention. Replaces the
// dashed-card "What we think" pattern. No card frame, no italic (brand.md
// locked rule), emphasis comes from weight + color.
//
// Body copy can use:
//   <strong> — bumps to text + weight 500
//   <span data-num> — bumps to mono medium for inline numbers

import { cn } from "@/lib/utils/cn";

interface EditorialPullquoteProps {
  label?: string;
  children: React.ReactNode;
  className?: string;
}

export function EditorialPullquote({
  label = "What we think",
  children,
  className,
}: EditorialPullquoteProps) {
  return (
    <div
      className={cn(
        "border-l-2 border-coral py-1 pl-5 sm:pl-6 [&_strong]:font-medium [&_strong]:text-text [&_[data-num]]:font-mono [&_[data-num]]:font-medium [&_[data-num]]:tabular-nums [&_[data-num]]:text-text",
        className,
      )}
    >
      <p className="mb-3 font-mono text-[9px] uppercase tracking-[0.16em] text-coral">
        {label}
      </p>
      <div className="text-[17px] leading-[1.55] text-text-body sm:text-[18px]">
        {children}
      </div>
    </div>
  );
}
