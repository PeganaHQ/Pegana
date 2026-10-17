import * as React from "react";

import { cn } from "@/lib/utils/cn";

// V5 text input. Containers law: inputs are NOT pills — 10px radius, hairline
// border, surface-1 fill. Focus signals via border-color (border-text), the
// same convention every ad-hoc input in the app already used before this
// primitive existed (webhook-create-form, asset-picker's search field) — see
// globals.css's focus-visible carve-out: form fields are excluded from the
// global keyboard-ring rule because they already have their own focus tell.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full min-w-0 rounded-[10px] border border-hairline bg-surface-1 px-3 py-2",
        "text-[13px] text-text placeholder:text-text-caption",
        "transition-[color,background-color,border-color,box-shadow] duration-200 outline-none",
        "focus-visible:border-outline focus-visible:ring-3 focus-visible:ring-text/10",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-st-depeg/70 aria-invalid:focus-visible:ring-st-depeg/20",
        "file:border-0 file:bg-transparent file:text-[13px] file:font-medium file:text-text",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
