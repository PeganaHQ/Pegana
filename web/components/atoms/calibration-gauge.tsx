"use client";

import { cn } from "@/lib/utils/cn";
import type { AssetCardData } from "@/lib/api/types";

// Calibration confidence gauge — a compact radial indicator showing
// whether an asset is fully calibrated or still in provisional/beta
// monitoring. Renders nothing for calibrated assets (the default healthy
// state doesn't need a badge — only deviation from the norm does).
// The gauge is a 3/4 circular arc with a needle pointing to the
// calibration status: "Calibrated" (green, 100%), "Provisional" (amber, 50%),
// or "No data" (grey, 25%).

const STATUS = {
  calibrated: {
    label: "Calibrated",
    color: "var(--color-st-pegged)",
    angle: 180,
  },
  provisional: {
    label: "Provisional",
    color: "var(--color-st-drift)",
    angle: 90,
  },
  nodata: {
    label: "No data",
    color: "var(--color-st-unknown)",
    angle: 45,
  },
} as const;

export function CalibrationGauge({
  asset,
  className,
  size = 36,
}: {
  asset: AssetCardData;
  className?: string;
  size?: number;
}) {
  // Only render for non-calibrated assets — calibrated is the norm and
  // doesn't need a visual signal.
  if (asset.calibration === "calibrated" || !asset.calibration) return null;

  const status =
    asset.calibration === "provisional"
      ? STATUS.provisional
      : STATUS.nodata;

  const radius = size / 2 - 4;
  const cx = size / 2;
  const cy = size / 2;
  const stroke = 2.5;

  // Arc from -225deg to 45deg (270deg sweep, 3/4 circle)
  const startAngle = -225;
  const endAngle = 45;
  const needleAngle = -225 + (status.angle / 270) * 270;

  const arc = describeArc(cx, cy, radius, startAngle, endAngle);

  return (
    <div
      className={cn("inline-flex items-center gap-2", className)}
      title={`Calibration: ${status.label}`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden
      >
        {/* Background arc (track) */}
        <path
          d={arc}
          fill="none"
          stroke="var(--color-hairline)"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        {/* Needle */}
        <line
          x1={cx}
          y1={cy}
          x2={cx + Math.cos((needleAngle * Math.PI) / 180) * (radius - 2)}
          y2={cy + Math.sin((needleAngle * Math.PI) / 180) * (radius - 2)}
          stroke={status.color}
          strokeWidth={1.8}
          strokeLinecap="round"
        />
        {/* Center dot */}
        <circle cx={cx} cy={cy} r={1.5} fill={status.color} />
      </svg>
      <span
        className="font-mono text-[9px] uppercase tracking-[0.08em]"
        style={{ color: status.color }}
      >
        {status.label}
      </span>
    </div>
  );
}

// SVG arc helper — converts polar coordinates to an SVG path
function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
): string {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

function polarToCartesian(
  cx: number,
  cy: number,
  r: number,
  angleDeg: number,
): { x: number; y: number } {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}
