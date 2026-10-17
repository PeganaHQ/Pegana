import { cn } from "@/lib/utils/cn";

/**
 * The card surface, in one place.
 *
 * Ten files had each pasted their own version of the same string, and by the
 * time they were collected they no longer agreed:
 *
 *   compare/page.tsx        transition-[box-shadow,transform,border-color]
 *   asset-action-strip.tsx  transition-[box-shadow,transform]
 *   comparable-events.tsx   transition-[box-shadow]  (and no press feedback)
 *   webhook-list.tsx        rounded-[14px]
 *   most others             rounded-[16px]
 *
 * None of that divergence was a decision. It is what happens when the tuning
 * knob for "how a card feels when you touch it" is spread across ten files:
 * the next person tunes one and the other nine drift further.
 *
 * DESIGN.md §3 governs the values: hairline borders, container radii in the
 * 14-22px band, and NO drop shadows on cards (the two floating objects, the
 * hero board and the receipt, are the only exceptions and do not use this).
 * Depth here comes from the border and the hover ring.
 */
export interface CardSurfaceOptions {
  /** Container radius. DESIGN.md §3 keeps these between 14 and 22. */
  radius?: 14 | 16 | 20;
  /**
   * Whether the card responds to pointer and touch. Off for purely
   * informational panels, which should not suggest they can be pressed.
   */
  interactive?: boolean;
  /**
   * Adds `border-color` to the transition. Only for cards that actually change
   * their border on hover; listing a property that never changes just makes
   * the declaration lie.
   */
  animateBorder?: boolean;
  /**
   * Some cards sit directly on the canvas with only a hairline outline and no
   * fill (the dashboard's two highlight cards). Filling them is a visible
   * design change, not a refactor, so it has to be opt-out rather than
   * assumed.
   */
  background?: "surface-1" | "none";
  className?: string;
}

const RADIUS: Record<NonNullable<CardSurfaceOptions["radius"]>, string> = {
  14: "rounded-[14px]",
  16: "rounded-[16px]",
  20: "rounded-[20px]",
};

export function cardSurface({
  radius = 16,
  interactive = true,
  animateBorder = false,
  background = "surface-1",
  className,
}: CardSurfaceOptions = {}): string {
  // Written out, never assembled. Tailwind scans source TEXT for class names,
  // so a template literal like `transition-[${list}]` compiles to no CSS at
  // all and the transition silently disappears.
  const transition = animateBorder
    ? "transition-[box-shadow,transform,border-color]"
    : "transition-[box-shadow,transform]";

  return cn(
    RADIUS[radius],
    "border border-hairline",
    background === "surface-1" && "bg-surface-1",
    interactive && [
      transition,
      "duration-150 ease-out",
      "hover:ring-2 hover:ring-outline/80",
      animateBorder && "hover:border-outline",
      // Press feedback. Paired with the `motion-reduce` escape so a user who
      // asked for less motion gets the ring without the squeeze.
      "active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
    ],
    className,
  );
}
