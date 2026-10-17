"use client";

import * as React from "react";
import type { GlossaryTerm } from "@/lib/glossary";

interface GlossaryContextValue {
  open: boolean;
  setOpen: (next: boolean) => void;
  /** Open the sheet scrolled to a specific term. */
  openAt: (term: GlossaryTerm) => void;
  /** The term the user came from — used to scroll the sheet to the right
   *  row and apply a brief highlight. Null when opened via the global
   *  "Glossary" button (no specific focus). */
  focusTerm: GlossaryTerm | null;
}

const GlossaryContext = React.createContext<GlossaryContextValue | null>(null);

export function GlossaryProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpenState] = React.useState(false);
  const [focusTerm, setFocusTerm] = React.useState<GlossaryTerm | null>(null);

  const setOpen = React.useCallback((next: boolean) => {
    setOpenState(next);
    if (!next) setFocusTerm(null);
  }, []);

  const openAt = React.useCallback((term: GlossaryTerm) => {
    setFocusTerm(term);
    setOpenState(true);
  }, []);

  const value = React.useMemo(
    () => ({ open, setOpen, openAt, focusTerm }),
    [open, setOpen, openAt, focusTerm],
  );

  return (
    <GlossaryContext.Provider value={value}>
      {children}
    </GlossaryContext.Provider>
  );
}

export function useGlossary(): GlossaryContextValue {
  const ctx = React.useContext(GlossaryContext);
  if (!ctx)
    throw new Error("useGlossary must be used within <GlossaryProvider>");
  return ctx;
}
