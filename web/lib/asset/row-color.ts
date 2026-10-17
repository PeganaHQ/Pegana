// Row color maps shared by every worst-first board (dashboard's board,
// /assets screener, dashboard's "Most volatile" answer-card metric) — kept
// in ONE place so these were previously byte-identical Record literals
// copied across three files can't drift out of sync with each other.

// Jitter is dispersion, not a peg state — state colors are reserved for
// states (brand law: semantic colors are data, never borrowed for emphasis).
// The number stays neutral; the STEADY/CHOPPY/VOLATILE caption carries meaning.
export const JITTER_COLOR: Record<string, string> = {
  steady: "text-text-muted",
  choppy: "text-text",
  volatile: "text-text",
  unknown: "text-text-caption",
};

export const SAFETY_COLOR: Record<string, string> = {
  A: "text-st-pegged",
  B: "text-text",
  C: "text-st-drift",
  D: "text-st-depeg-text",
};
