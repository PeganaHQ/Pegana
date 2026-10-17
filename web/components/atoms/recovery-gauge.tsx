// Circular gauge for the recovery-confidence card. 84px svg with a fixed
// 36-radius arc; the fill is an iridescent gradient when score is high
// (A/B) and falls back to muted hairline when low (C/D).

interface RecoveryGaugeProps {
  /** 0-100 — percentage filled along the ring. */
  pct: number;
  /** Letter grade derived from pct (A=90+, B=70+, C=50+, D<50). */
  grade: "A" | "B" | "C" | "D";
  label?: string;
  size?: number;
}

const GRADE_COLOR: Record<"A" | "B" | "C" | "D", string> = {
  A: "var(--color-st-pegged)",
  B: "var(--color-text)",
  C: "var(--color-st-drift)",
  D: "var(--color-st-depeg)",
};

const GRADE_LABEL: Record<"A" | "B" | "C" | "D", string> = {
  A: "High",
  B: "Moderate",
  C: "Watch",
  D: "Stressed",
};

export function RecoveryGauge({
  pct,
  grade,
  label,
  size = 60,
}: RecoveryGaugeProps) {
  const r = (size - 10) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.min(1, Math.max(0, pct / 100)));

  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <div
        className="relative"
        style={{ width: size, height: size }}
        role="img"
        aria-label={`Recovery confidence ${grade}, ${Math.round(pct)} percent`}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          aria-hidden
          className="absolute inset-0"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="rgba(var(--color-text-rgb), 0.08)"
            strokeWidth={4}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={GRADE_COLOR[grade]}
            strokeWidth={4}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            strokeLinecap="round"
          />
        </svg>
        <div
          aria-hidden
          className="absolute inset-0 flex items-center justify-center font-mono font-medium tabular-nums"
          style={{
            color: GRADE_COLOR[grade],
            fontSize: Math.round(size * 0.36),
            letterSpacing: "0.04em",
          }}
        >
          {grade}
        </div>
      </div>
      <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-text-caption">
        {label ?? `${GRADE_LABEL[grade]} · ${Math.round(pct)}%`}
      </div>
    </div>
  );
}
