import { render, type RenderOptions } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GlossaryProvider } from "@/lib/store/glossary-context";
import type { ReactElement, ReactNode } from "react";

function AllProviders({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={0}>
      <GlossaryProvider>{children}</GlossaryProvider>
    </TooltipProvider>
  );
}

/**
 * Drop-in replacement for `@testing-library/react`'s `render` that wraps
 * the tree with every context our components depend on (currently:
 * shadcn TooltipProvider).
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  return render(ui, { wrapper: AllProviders, ...options });
}

export * from "@testing-library/react";
