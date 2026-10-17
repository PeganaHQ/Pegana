import * as React from "react";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils/cn";

// Native <select>, styled — deliberately NOT a Radix/headless combobox. The
// browser's own listbox is more usable on mobile (native scroll wheel /
// sheet) and it's one less focus trap to maintain. `appearance-none` strips
// the UA arrow so our own chevron (which sits in the same visual slot as
// Input's trailing icon, if any) reads consistently across browsers.
function Select({
  className,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="select"
        className={cn(
          "flex h-9 w-full min-w-0 appearance-none rounded-[10px] border border-hairline bg-surface-1 py-2 pl-3 pr-8",
          "text-[13px] text-text",
          "transition-[color,background-color,border-color,box-shadow] duration-200 outline-none",
          "focus-visible:border-outline focus-visible:ring-3 focus-visible:ring-text/10",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "aria-invalid:border-st-depeg/70",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-text-caption"
      />
    </div>
  );
}

export { Select };
