// W2 (2026-07-03): the methodology page's "formula as art" object —
// `spread = 1 - market / intrinsic`, numerator underlined with the one
// sanctioned iridescent content-moment per DESIGN.md's budget for this page.
// The formula itself never changes, so this takes no data props beyond the
// caption (which carries the real EWMA alpha / hysteresis constants already
// hardcoded in the methodology crate) and the input chips.

export function MathObjectV2({
  caption,
  chips,
}: {
  caption: string;
  chips: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="v2-in-math">
      <span className="v2-in-expr">
        spread <span className="v2-in-op">=</span> 1{" "}
        <span className="v2-in-op">&minus;</span>
        <span className="v2-in-frac">
          <span className="relative inline-block px-3.5 pb-2">
            market
            <span className="v2-in-mathbar" aria-hidden />
          </span>
          <span className="px-3.5 pt-2">intrinsic</span>
        </span>
      </span>
      <div className="v2-in-cap">{caption}</div>
      <div className="v2-in-chips">
        {chips.map((c) => (
          <span key={c.label} className="v2-in-chip">
            <b>{c.label}</b> {c.value}
          </span>
        ))}
      </div>
    </div>
  );
}
