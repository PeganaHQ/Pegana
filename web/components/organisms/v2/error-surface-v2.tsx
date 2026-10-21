import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import {
  EyebrowPillV2,
  PillGhost,
  PillPrimary,
} from "@/components/organisms/v2/shared";

// V5 error surface (W1, 2026-07-03) — port of the approved
// pegana-v5-errors.html artifact (pixel-truth for tokens/sizes/spacing/copy).
// Used by app/not-found.tsx, app/error.tsx and
// app/(marketing)/audit/[id]/not-found.tsx.
//
// Premium elevation pass (2026-08-05): added radar-sweep motif, 404 watermark,
// live-asset quick-pick strip, radial glow bg. Copy tuned for peg-risk voice.
//
// Server-safe: this component itself has no "use client" directive and no
// hooks, so a Server Component (not-found.tsx) can render it directly. The
// only interactive bit — the "reset" CTA action.tsx needs — is a plain
// <button onClick>; that's fine because error.tsx (the only caller that uses
// it) is already a "use client" boundary itself, so nothing here needs to
// cross a server/client split on its own.

export type ErrorSurfaceState = "unknown" | "critical";

interface ErrorSurfaceLinkCta {
  label: string;
  href: string;
}

interface ErrorSurfaceResetCta {
  label: string;
  action: "reset";
  onReset: () => void;
}

export interface ErrorSurfaceV2Props {
  eyebrow: string;
  headline: string;
  sub: string;
  state: ErrorSurfaceState;
  /** Short label on the motif's endpoint, e.g. "404", "500", "?". */
  endLabel: string;
  primary: ErrorSurfaceLinkCta | ErrorSurfaceResetCta;
  secondary: ErrorSurfaceLinkCta;
  /**
   * Standalone pages (404 / error.tsx) own the full viewport: full-bleed
   * grain, ~100dvh. Non-standalone (audit/[id]'s
   * not-found) renders inside a layout that already has SiteNavV2/SiteFooterV2
   * chrome around it, so it skips the grain and uses a shorter ~70vh so it
   * doesn't read as its own full page.
   */
  standalone?: boolean;
}

// Twin hex literals of --v2-unk / --v2-crit (app/(marketing)/v2.css). Needed
// as real color literals for SVG fill/stroke attributes and the precomputed
// glow/border rgba below — same reasoning as SPARK_PEG_HEX/SPARK_DRIFT_HEX in
// shared.tsx (var() doesn't resolve inside every attribute context we need
// here, e.g. building a new rgba() string).
const ERR_STATE: Record<
  ErrorSurfaceState,
  { hex: string; label: string; border: string; glow: string }
> = {
  unknown: {
    hex: "#8f8aa3",
    label: "Unknown",
    border: "rgba(143, 138, 163, .38)",
    glow: "rgba(143, 138, 163, .09)",
  },
  critical: {
    hex: "#e0574e",
    label: "Critical",
    border: "rgba(224, 87, 78, .38)",
    glow: "rgba(224, 87, 78, .09)",
  },
};

// Same classes as PillPrimary (components/organisms/v2/shared.tsx), which
// only ever renders a <Link>. Duplicated here (not exported/shared) because
// the "reset" CTA has to be a real <button onClick>, not a navigable href.
const RESET_BUTTON_CLASS =
  "group inline-flex items-center gap-2 rounded-full whitespace-nowrap font-mono text-[12px] font-medium uppercase tracking-[0.09em] transition-[transform,box-shadow,background,border-color] duration-[280ms] ease-[var(--v2-ease)] bg-white text-[#141118] shadow-[0_4px_20px_rgba(0,0,0,.35)] hover:-translate-y-px hover:bg-[#efeaf6] hover:shadow-[0_10px_30px_rgba(0,0,0,.5)] px-6 py-3 max-[759px]:min-h-[46px] max-[759px]:justify-center";

function DriftMotif({
  state,
  endLabel,
}: {
  state: ErrorSurfaceState;
  endLabel: string;
}) {
  const st = ERR_STATE[state];
  return (
    <div className="v2-err-motif relative mb-[38px]">
      {/* Radial glow — soft ambient from the center using state color */}
      <div
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          inset: "-120px",
          background: `radial-gradient(closest-side, ${st.glow}, transparent 72%)`,
        }}
      />
      {/* Radar sweep — three concentric rings expanding from center */}
      <svg
        viewBox="0 0 420 180"
        width={420}
        height={180}
        fill="none"
        aria-hidden
        className="relative"
      >
        <defs>
          <linearGradient id="v2-err-drift-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ff8a5b" />
            <stop offset="0.22" stopColor="#ff8400" />
            <stop offset="0.48" stopColor="#fb6fae" />
            <stop offset="0.74" stopColor="#e878d8" />
            <stop offset="1" stopColor="#df91f7" />
          </linearGradient>
        </defs>

        {/* Published surfaces dashed line */}
        <line
          x1="6"
          y1="42"
          x2="414"
          y2="42"
          stroke="rgba(255,255,255,.14)"
          strokeWidth="1"
          strokeDasharray="1 6"
          strokeLinecap="round"
        />
        <text
          x="414"
          y="30"
          textAnchor="end"
          className="font-mono text-[12px] tracking-[0.08em]"
          fill="var(--v2-dim)"
        >
          published surfaces
        </text>

        {/* Concentric radar rings around the endpoint */}
        {[12, 20, 28].map((r, i) => (
          <circle
            key={r}
            cx="368"
            cy="130"
            r={r}
            stroke={st.hex}
            strokeOpacity={0.3 - i * 0.08}
            strokeWidth="1"
            className="v2-err-ring"
            style={{
              animation: `v2-err-ping 3s cubic-bezier(0.22,1,0.36,1) ${i * 0.8}s infinite`,
            }}
          />
        ))}

        {/* Drift path */}
        <path
          className="v2-err-drift"
          d="M 6 42 L 150 42 C 240 42, 260 130, 368 130"
          stroke="url(#v2-err-drift-grad)"
          strokeWidth="1.75"
          strokeLinecap="round"
        />

        {/* Endpoint dot */}
        <circle cx="368" cy="130" r="4" fill={st.hex} />
        <circle
          cx="368"
          cy="130"
          r="8"
          stroke={st.hex}
          strokeOpacity=".35"
          strokeWidth="1"
        />
        <text
          x="384"
          y="134"
          className="font-mono text-[12px] tracking-[0.08em]"
          fill={st.hex}
          fillOpacity=".9"
        >
          {endLabel}
        </text>
      </svg>

      <span
        className="v2-err-statepill absolute -bottom-4 -right-3.5 inline-flex items-center gap-[7px] rounded-full px-3 py-[5px] font-mono text-[12px]"
        style={{
          color: st.hex,
          border: `1px solid ${st.border}`,
          background: "rgba(10,10,11,.72)",
        }}
      >
        <i
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: st.hex }}
        />
        {st.label}
      </span>
    </div>
  );
}

export function ErrorSurfaceV2({
  eyebrow,
  headline,
  sub,
  state,
  endLabel,
  primary,
  secondary,
  standalone = false,
}: ErrorSurfaceV2Props) {
  const st = ERR_STATE[state];
  return (
    <section
      className={cn(
        "relative flex flex-col overflow-hidden",
        standalone ? "min-h-[100dvh]" : "min-h-[70vh]",
      )}
    >
      {/* 404/500 watermark — huge ghost number in the background */}
      {standalone && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none font-mono text-[clamp(120px,22vw,220px)] font-medium leading-none tracking-[-0.04em]"
          style={{ color: st.hex, opacity: 0.04 }}
        >
          {endLabel}
        </span>
      )}

      <div className="relative flex flex-1 flex-col items-center justify-center px-6 pb-24 pt-28 text-center sm:px-8 sm:pt-32">
        <DriftMotif state={state} endLabel={endLabel} />

        <EyebrowPillV2 className="v2-err-eyebrow">{eyebrow}</EyebrowPillV2>

        <h1 className="v2-err-h1 mb-4 max-w-[17ch] text-balance text-[clamp(34px,5vw,52px)] font-semibold leading-[1.06] tracking-[-0.025em]">
          {headline}
        </h1>

        <p className="v2-err-sub mb-10 max-w-[44ch] text-balance text-[15.5px] leading-[1.65] text-[var(--v2-muted)]">
          {sub}
        </p>

        <div className="v2-err-ctas flex flex-wrap justify-center gap-3.5">
          {"action" in primary ? (
            <button
              type="button"
              onClick={primary.onReset}
              className={RESET_BUTTON_CLASS}
            >
              {primary.label}
              <span
                aria-hidden
                className="-my-1 ml-0.5 -mr-2.5 grid h-[22px] w-[22px] place-items-center rounded-full bg-[rgba(20,17,24,.09)] text-[12px] transition-transform duration-500 ease-[var(--v2-ease-phys)] group-hover:translate-x-0.5"
              >
                →
              </span>
            </button>
          ) : (
            <PillPrimary href={primary.href}>{primary.label}</PillPrimary>
          )}
          <PillGhost href={secondary.href}>{secondary.label}</PillGhost>
        </div>

        {/* Live-asset quick-pick strip — turns the 404 from a dead end into
            a launchpad. Only on standalone (404/error), not the audit
            sub-not-found. */}
        {standalone && (
          <div className="mt-16 flex flex-col items-center gap-3">
            <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--v2-dim)]">
              Or jump straight to a live asset
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {QUICK_PICKS.map((pick) => (
                  <Link
                    key={pick.symbol}
                    href={`/asset/${encodeURIComponent(pick.symbol)}`}
                    className="group inline-flex items-center gap-2 rounded-full border border-[var(--v2-line)] px-3.5 py-2 font-mono text-[12px] text-[var(--v2-muted)] transition-[border-color,color,background] duration-300 hover:border-[var(--v2-line2)] hover:bg-white/[0.03] hover:text-[var(--v2-text)]"
                  >
                    {pick.label}
                  </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {standalone && <div aria-hidden className="v2-err-grain" />}
    </section>
  );
}

const QUICK_PICKS = [
  { symbol: "USDC", label: "USDC" },
  { symbol: "jitoSOL", label: "jitoSOL" },
  { symbol: "USDe", label: "USDe" },
  { symbol: "INF", label: "INF" },
];
