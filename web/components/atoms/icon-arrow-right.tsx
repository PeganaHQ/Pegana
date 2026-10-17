import { cn } from "@/lib/utils/cn";

interface IconArrowProps {
  className?: string;
  size?: number;
  strokeWidth?: number;
}

export function IconArrowRight({
  className,
  size = 12,
  strokeWidth = 1.5,
}: IconArrowProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      className={cn("inline-block shrink-0", className)}
    >
      <path d="M2 6 L10 6" />
      <path d="M6.5 2.5 L10 6 L6.5 9.5" />
    </svg>
  );
}

export function IconArrowUpRight({
  className,
  size = 12,
  strokeWidth = 1.5,
}: IconArrowProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      className={cn("inline-block shrink-0", className)}
    >
      <path d="M3.5 8.5 L8.5 3.5" />
      <path d="M4 3.5 L8.5 3.5 L8.5 8" />
    </svg>
  );
}

export function IconArrowLeft({
  className,
  size = 12,
  strokeWidth = 1.5,
}: IconArrowProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      className={cn("inline-block shrink-0", className)}
    >
      <path d="M2 6 L10 6" />
      <path d="M5.5 2.5 L2 6 L5.5 9.5" />
    </svg>
  );
}
