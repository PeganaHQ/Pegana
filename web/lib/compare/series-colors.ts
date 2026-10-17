// Series IDENTITY colors — up to 4 overlaid assets on /compare. Deliberately
// NOT the peg-STATE palette (green/amber/pink/red): on a peg-risk chart a line
// drawn in depeg-pink reads as "this asset is depegged" when it only means
// "series #3" — a genuine semantic collision (the same asset's real state pill
// sits in the metric table right below). Identity gets its own hues — coral /
// lavender / blue / magenta — each distinct from every state color, so a line's
// color answers "which asset" and never "what state".
//
// Lives in its own tiny module (not compare-chart.tsx) so the /compare page can
// share it for its pill + card swatches WITHOUT statically importing the heavy,
// dynamically-loaded chart component (which would defeat its code-split). The
// chart line and its legend chip therefore always match, from one source.
export const SERIES_IDENTITY_COLORS: readonly string[] = [
  "#ff8a5b", // coral
  "#df91f7", // lavender
  "#5ea6ff", // blue
  "#e878d8", // magenta
];

export function seriesColor(i: number): string {
  return SERIES_IDENTITY_COLORS[i % SERIES_IDENTITY_COLORS.length];
}
