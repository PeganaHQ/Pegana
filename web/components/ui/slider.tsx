"use client";
/**
 * shadcn Slider customized for Pegana brand:
 *  - sharp corners (radius 0) instead of rounded-full
 *  - hairline track on surface-2
 *  - filled range in text color (high-contrast)
 *  - 14×14 thumb in text color, focusable, hit-padded
 *
 * `aria-label`/`aria-labelledby` are pulled off the props destined for
 * `SliderPrimitive.Root` and forwarded to `SliderPrimitive.Thumb` instead —
 * Root is a non-interactive positioning wrapper, Thumb is the element Radix
 * renders with `role="slider"`. A label on Root is invisible to a11y tools.
 */

import * as React from "react";
import { Slider as SliderPrimitive } from "radix-ui";

import { cn } from "@/lib/utils/cn";

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max],
  );

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative h-[3px] grow overflow-hidden bg-surface-2"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute h-full bg-text select-none"
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          className={cn(
            "relative block h-3.5 w-3.5 shrink-0 select-none",
            "bg-text border border-text transition-transform",
            // Hit padding for touch
            "after:absolute after:-inset-2",
            "hover:scale-110 active:scale-95",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        />
      ))}
    </SliderPrimitive.Root>
  );
}

export { Slider };
