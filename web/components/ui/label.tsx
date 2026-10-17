import * as React from "react";

import { cn } from "@/lib/utils/cn";

// Canonical form label — mono caption idiom (brand.md allows mono for
// technical/caption text). Every text-input field on the site should read
// through this component instead of a local `<span className="font-mono
// text-[10px] uppercase ...">` copy, so a label-style change is one edit.
function Label({
  className,
  ...props
}: React.ComponentProps<"label"> & { disabled?: boolean }) {
  const { disabled, ...rest } = props;
  return (
    <label
      data-slot="label"
      data-disabled={disabled ? "" : undefined}
      className={cn(
        "block font-mono text-[11px] uppercase tracking-[0.08em] text-text-caption",
        "data-disabled:opacity-50",
        className,
      )}
      {...rest}
    />
  );
}

export { Label };
