"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Copy, Check as CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useAsset } from "@/lib/hooks/use-asset";
import { formatValue, reconcileBps } from "@/lib/api/format";
import { useRevealV2 } from "@/lib/motion/use-reveal-v2";
import { useAppReducedMotion } from "@/lib/motion/use-reduced-motion";
import {
  AssetChartCanvas,
  type AssetChartCanvasHandle,
} from "@/components/organisms/v2/asset-chart-canvas";
import {
  StatePillV2,
  bandProximityPct,
  dashSafe,
  timeAgoShort,
  v2SpreadSignClass,
} from "@/components/organisms/v2/shared";

// DESIGN.md §5.4 — pill tabs ASSET DETAIL / ALERTS / API → split panes
// (checklist left, real-fidelity visual right). The asset-detail pane binds
// to `useAsset('jitosol')` (DESIGN.md §7); while loading or on error it keeps
// the artifact's jitoSOL sample values — same numbers, same honesty rule as
// the hero board (the board carries the visible "sample" caption).

type TabId = "detail" | "alerts" | "api";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "detail", label: "asset detail" },
  { id: "alerts", label: "alerts" },
  { id: "api", label: "api" },
];

// jitoSOL reference used by the illustrative chart's hover-scrub readout
// (DESIGN.md port — same constant the artifact hardcodes for the sample row).
const CHART_REF_PRICE = 177.15;

function Check({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-[11px] text-[14.5px] leading-[1.5] text-[var(--v2-muted)]">
      <span
        aria-hidden
        className="mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-[rgba(95,211,160,.14)] text-[10px] text-[var(--v2-peg)]"
      >
        ✓
      </span>
      <span>{children}</span>
    </div>
  );
}

function B({ children }: { children: React.ReactNode }) {
  return <b className="font-medium text-[var(--v2-text)]">{children}</b>;
}

/** Quiet copy affordance — mono uppercase ghost pill, "copied" for 1.4s. */
function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  async function onClick() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard blocked (permissions/unsupported) — no-op */
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Copy request URL"
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-[var(--v2-line)] px-2.5 py-[3px] font-mono text-[10px] tracking-[0.08em] text-[var(--v2-dim)] uppercase transition-colors duration-200 hover:border-[var(--v2-line2)] hover:text-[var(--v2-text)]",
        className,
      )}
    >
      {copied ? (
        <CheckIcon aria-hidden className="size-3 text-[var(--v2-peg)]" />
      ) : (
        <Copy aria-hidden className="size-3" />
      )}
      copy{copied && <span className="text-[var(--v2-peg)]"> copied</span>}
    </button>
  );
}

const paneShell =
  "grid overflow-hidden rounded-[20px] border border-[var(--v2-line)] bg-[var(--v2-panel)] scene:grid-cols-[.9fr_1.25fr]";
const paneTxt =
  "border-b border-[var(--v2-line)] px-8 py-9 scene:border-b-0 scene:border-r";
const paneVis =
  "flex items-center p-[26px] [background:linear-gradient(180deg,rgba(255,255,255,.02),transparent)]";
const visCard =
  "w-full overflow-hidden rounded-[14px] border border-[var(--v2-line)] bg-[var(--v2-bg2)]";
const vcHead =
  "flex items-center justify-between border-b border-[var(--v2-line)] px-[18px] py-[13px] text-[13px]";

export function ProductTabsV2() {
  const [tab, setTab] = useState<TabId>("detail");
  const reduced = useAppReducedMotion();
  const chartRef = useRef<AssetChartCanvasHandle | null>(null);
  const { data: jito } = useAsset("jitosol");

  const h2 = useRevealV2<HTMLHeadingElement>({ index: 0 });
  const lead = useRevealV2<HTMLParagraphElement>({ index: 1 });
  const tabs = useRevealV2<HTMLDivElement>({ index: 2 });
  const pane = useRevealV2<HTMLDivElement>({ index: 3 });

  // --- sliding tab thumb (v5 S3) ---
  const tablistRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLSpanElement | null>(null);
  const activeTabRef = useRef<HTMLButtonElement | null>(null);

  const placeThumb = () => {
    const on = activeTabRef.current;
    const thumbEl = thumbRef.current;
    if (!on || !thumbEl) return;
    thumbEl.style.width = `${on.offsetWidth}px`;
    thumbEl.style.transform = `translateX(${on.offsetLeft}px)`;
  };

  // `placeThumb` is intentionally not a dep: it's stable across renders (only
  // reads refs) and re-adding the listener on every render would be wasted
  // work — this repo's eslint config has no react-hooks plugin to flag it.
  useLayoutEffect(() => {
    placeThumb();
    window.addEventListener("resize", placeThumb);
    return () => window.removeEventListener("resize", placeThumb);
  }, [tab]);

  // --- pane entrance (v5 S3): replay the draw-in each time a pane becomes
  // active, matching the artifact's remove/reflow/add dance so the animation
  // reliably restarts even if a browser doesn't reset it purely from the
  // `hidden` attribute toggling display. ---
  const detailPaneRef = useRef<HTMLDivElement | null>(null);
  const alertsPaneRef = useRef<HTMLDivElement | null>(null);
  const apiPaneRef = useRef<HTMLDivElement | null>(null);
  // Memoized so the object identity is stable across renders (the refs
  // themselves never change) — lets the effect below list it as a dep
  // without re-running on every unrelated render.
  const paneRefs = useMemo(
    () => ({
      detail: detailPaneRef,
      alerts: alertsPaneRef,
      api: apiPaneRef,
    }),
    [],
  );

  useLayoutEffect(() => {
    if (reduced) return;
    const el = paneRefs[tab].current;
    if (!el) return;
    el.classList.remove("v2-pane-enter");
    void el.offsetWidth; // force reflow so the animation restarts
    el.classList.add("v2-pane-enter");
  }, [tab, reduced, paneRefs]);

  // --- chart hover-scrub (v5 S3) ---
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const hoverCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const wrap = chartWrapRef.current;
    const hoverCanvas = hoverCanvasRef.current;
    const tipEl = tipRef.current;
    if (!wrap || !hoverCanvas || !tipEl) return;

    function onPointerMove(e: PointerEvent) {
      const frame = chartRef.current?.getFrame();
      if (!frame) return;
      const r = wrap!.getBoundingClientRect();
      const x = e.clientX - r.left;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      hoverCanvas!.width = frame.w * dpr;
      hoverCanvas!.height = frame.h * dpr;
      hoverCanvas!.style.width = `${frame.w}px`;
      hoverCanvas!.style.height = `${frame.h}px`;
      const ctx = hoverCanvas!.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, frame.w, frame.h);

      if (x < 0 || x > frame.w) {
        tipEl!.style.opacity = "0";
        return;
      }
      const i = Math.max(
        0,
        Math.min(
          frame.pts.length - 1,
          Math.round((x / frame.w) * (frame.pts.length - 1)),
        ),
      );
      const pt = frame.pts[i];
      ctx.strokeStyle = "rgba(255,255,255,.16)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pt[0], 6);
      ctx.lineTo(pt[0], frame.h - 4);
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], 2.6, 0, Math.PI * 2);
      ctx.fill();

      const dev = (pt[1] - frame.base) / (frame.h * frame.scale);
      const market = (CHART_REF_PRICE - dev * 1.043).toFixed(2);
      // reconcileBps convention: positive = discount (market below the
      // CHART_REF_PRICE reference), negative = premium. Holder-signed display
      // negates it: `+` = premium, `−` = discount (same rule as spreadLabel
      // below, merge.ts, and shared.tsx's toBoardRow).
      const bps = Math.round((1 - Number(market) / CHART_REF_PRICE) * 10000);
      const holderBps = -bps;

      tipEl!.textContent = `market ${market} · `;
      const b = document.createElement("b");
      b.className = "font-medium text-[var(--v2-drift)]";
      b.textContent = `${holderBps >= 0 ? "+" : ""}${(holderBps / 100).toFixed(2)}%`;
      tipEl!.appendChild(b);
      tipEl!.style.left = `${pt[0]}px`;
      tipEl!.style.top = `${pt[1] - 4}px`;
      tipEl!.style.opacity = "1";
    }

    function onPointerLeave() {
      tipEl!.style.opacity = "0";
      const ctx = hoverCanvas!.getContext("2d");
      ctx?.clearRect(0, 0, hoverCanvas!.width, hoverCanvas!.height);
    }

    wrap.addEventListener("pointermove", onPointerMove);
    wrap.addEventListener("pointerleave", onPointerLeave);
    return () => {
      wrap.removeEventListener("pointermove", onPointerMove);
      wrap.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

  // Live jitoSOL values with the artifact's sample fallbacks. reconcileBps is
  // signed intrinsic−market (positive = discount, negative = premium) — the
  // opposite of the holder-facing sign, so negate for display. Same rule as
  // /lst (merge.ts) + the hero board (shared.tsx's toBoardRow).
  const jitoBps = jito ? reconcileBps(jito).bps : null;
  // % for end users — "bps" is internal jargon (same holder-facing convention
  // as /lst + the hero board). The raw `spread_bps` field still appears below
  // in the literal API-payload sample, where it's the real field name.
  const spreadLabel =
    jitoBps != null
      ? `${-jitoBps > 0 ? "+" : ""}${(-jitoBps / 100).toFixed(2)}%`
      : "−0.41%"; // sample: market 176.42 < intrinsic 177.15 ⇒ a discount
  const marketLabel = jito?.market_usd
    ? dashSafe(formatValue(jito.market_usd))
    : "176.42";
  const intrinsicLabel = jito?.intrinsic_usd
    ? dashSafe(formatValue(jito.intrinsic_usd))
    : "177.15";
  const stateWord =
    jito?.state === "PEGGED"
      ? "holding its peg"
      : jito?.state === "DRIFT"
        ? "drifting"
        : jito?.state
          ? jito.state.toLowerCase().replace("_", " ")
          : "drifting";
  const updatedLabel = jito?.updated_at
    ? timeAgoShort(jito.updated_at, Date.now())
    : "18s";
  // Direction-sensitive (ADR-0021 carve-out): pass bps + class so a benign
  // jitoSOL premium never reads as near-depeg — only a genuine discount
  // (jitoBps > 0 under reconcileBps convention) counts toward the band.
  const bandPct = jito?.state
    ? bandProximityPct(jito.state, { bps: jitoBps, klass: jito.class })
    : null;
  const bandLabel = bandPct != null ? `${bandPct}%` : "58%";

  const selectTab = (next: TabId) => {
    setTab(next);
    if (next === "detail") {
      // Redraw the chart from zero when its pane becomes visible again —
      // matches the artifact's `if(t.id==='t1')drawChart(true)`.
      requestAnimationFrame(() => chartRef.current?.restart());
    }
  };

  return (
    <section className="py-[110px]" id="product">
      <div className="mx-auto max-w-[1180px] px-6 sm:px-10">
        <h2
          ref={h2.ref}
          style={h2.style}
          className="text-balance text-[clamp(30px,4.2vw,50px)] font-medium leading-[1.05] tracking-[-0.022em]"
        >
          One signal, three ways to consume it.
        </h2>
        <p
          ref={lead.ref}
          style={lead.style}
          className="mt-[18px] max-w-[56ch] text-[17px] leading-[1.62] text-[var(--v2-muted)]"
        >
          The board above is the surface. Underneath: a{" "}
          <B>per-asset risk view</B>, <B>alerts the moment a state changes</B>,
          and an <B>API that returns the same verdict you see</B>. Nothing is
          display-only.
        </p>

        <div
          ref={(el) => {
            tabs.ref.current = el;
            tablistRef.current = el;
          }}
          style={tabs.style}
          role="tablist"
          aria-label="Product views"
          className="relative mb-6 mt-[34px] flex w-fit flex-wrap gap-1.5 rounded-full border border-[var(--v2-line)] bg-white/[0.03] p-[5px] font-mono"
        >
          <span aria-hidden ref={thumbRef} className="v2-tab-thumb" />
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={tab === t.id ? activeTabRef : undefined}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              aria-controls={`v2-pane-${t.id}`}
              id={`v2-tab-${t.id}`}
              onClick={() => selectTab(t.id)}
              className={cn(
                "v2-ptab relative z-[1] rounded-full px-5 py-[9px] text-[12px] uppercase tracking-[0.09em] transition-[color,background-color] duration-[250ms]",
                tab === t.id
                  ? "bg-transparent font-medium text-[var(--v2-btn-dark)]"
                  : "text-[var(--v2-muted)] hover:text-[var(--v2-text)]",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div ref={pane.ref} style={pane.style}>
          {/* asset detail */}
          <div
            id="v2-pane-detail"
            ref={detailPaneRef}
            role="tabpanel"
            aria-labelledby="v2-tab-detail"
            hidden={tab !== "detail"}
            className={cn(paneShell, tab === "detail" && "grid")}
          >
            <div className={paneTxt}>
              <h3 className="text-[23px] font-medium tracking-[-0.015em]">
                Every asset, against its own reference.
              </h3>
              <p className="mt-3 text-[15px] leading-[1.6] text-[var(--v2-muted)]">
                A 0.41% discount is noise for one asset and a siren for another.
                Pegana judges each asset against its own thresholds, never a
                global rule.
              </p>
              <div className="mt-6 flex flex-col gap-3.5">
                <Check>
                  <B>NAV vs market, side by side</B>: the two numbers that
                  define the distance
                </Check>
                <Check>
                  <B>Band proximity</B>: how close the spread is to this
                  asset&rsquo;s own depeg line
                </Check>
                <Check>
                  <B>30-day state history</B>: every transition, timestamped and
                  receipted
                </Check>
              </div>
            </div>
            <div className={paneVis}>
              <div className={visCard}>
                <div className={vcHead}>
                  <span className="font-mono text-[12.5px]">
                    jitoSOL · asset view
                  </span>
                  <span className="font-mono text-[11px] text-[var(--v2-dim)]">
                    updated {updatedLabel} ago
                  </span>
                </div>
                <div className="p-[18px]">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-base font-semibold">
                      jitoSOL
                      <span className="ml-2 font-mono text-[11px] font-normal text-[var(--v2-dim)]">
                        LST · Jito staked SOL
                      </span>
                    </span>
                    <span
                      className={cn(
                        "font-mono text-[28px] font-medium tracking-[-0.01em] tabular-nums",
                        // spreadLabel above is holder-signed; jitoBps is RAW,
                        // and the −0.41% sample fallback is holder −41.
                        v2SpreadSignClass(jitoBps != null ? -jitoBps : -41),
                      )}
                    >
                      {spreadLabel}
                    </span>
                  </div>
                  <div className="mt-[3px] text-[12.5px] text-[var(--v2-dim)]">
                    market{" "}
                    <i className="not-italic font-medium text-[var(--v2-muted)]">
                      {marketLabel}
                    </i>{" "}
                    vs intrinsic NAV{" "}
                    <i className="not-italic font-medium text-[var(--v2-muted)]">
                      {intrinsicLabel}
                    </i>
                    ,{" "}
                    <b className="font-medium text-[var(--v2-drift)]">
                      {stateWord}
                    </b>
                    {", "}
                    {bandLabel} of the way to its depeg band
                  </div>
                  <div ref={chartWrapRef} className="relative">
                    <AssetChartCanvas ref={chartRef} />
                    <canvas
                      ref={hoverCanvasRef}
                      aria-hidden
                      className="pointer-events-none absolute left-0 top-0 h-[120px] w-full"
                    />
                    <div
                      ref={tipRef}
                      aria-hidden
                      className="pointer-events-none absolute z-[3] rounded-lg border border-[var(--v2-line2)] bg-[rgba(16,16,18,.94)] px-[9px] py-[5px] font-mono text-[10.5px] whitespace-nowrap text-[var(--v2-text)] opacity-0 transition-opacity duration-150"
                      style={{ transform: "translate(-50%,-135%)" }}
                    />
                  </div>
                  <div className="mt-3.5 flex gap-0.5">
                    {Array.from({ length: 30 }, (_, i) => {
                      const drift = [22, 23, 28, 29].includes(i);
                      return (
                        <span
                          key={i}
                          className={cn(
                            "h-2 flex-1 rounded-[2px]",
                            drift
                              ? "bg-[var(--v2-drift)] opacity-85"
                              : "bg-[var(--v2-peg)] opacity-50",
                          )}
                        />
                      );
                    })}
                  </div>
                  <div className="mt-2 flex justify-between font-mono text-[10.5px] text-[var(--v2-dim)]">
                    <span>30 days ago</span>
                    <span>2 drift episodes, 0 depegs</span>
                    <span>now</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* alerts */}
          <div
            id="v2-pane-alerts"
            ref={alertsPaneRef}
            role="tabpanel"
            aria-labelledby="v2-tab-alerts"
            hidden={tab !== "alerts"}
            className={paneShell}
          >
            <div className={paneTxt}>
              <h3 className="text-[23px] font-medium tracking-[-0.015em]">
                The state change finds you.
              </h3>
              <p className="mt-3 text-[15px] leading-[1.6] text-[var(--v2-muted)]">
                No dashboards to babysit. When an asset crosses its threshold,
                the transition is pushed with the receipt attached, so the alert
                itself is verifiable.
              </p>
              <div className="mt-6 flex flex-col gap-3.5">
                <Check>
                  <B>Live WebSocket feed</B>: every transition as it happens,
                  receipt attached
                </Check>
                <Check>
                  <B>Open Atom feed</B>: poll recent transitions with no client
                  to run
                </Check>
                <Check>
                  <B>Semantic thresholds</B>: read &ldquo;drift and worse&rdquo;,
                  not raw numbers
                </Check>
              </div>
            </div>
            <div className={paneVis}>
              <div className="flex w-full flex-col gap-2.5">
                <div className="rounded-[14px] border border-[var(--v2-line)] bg-white/[0.025] px-4 py-3.5">
                  <div className="flex items-center gap-[9px] text-[13px] font-semibold">
                    <span
                      aria-hidden
                      className="h-[22px] w-[22px] rounded-full [background:var(--color-coral)]"
                    />
                    live feed{" "}
                    <span className="font-mono text-[10.5px] font-normal text-[var(--v2-dim)]">
                      transition · 09:02 UTC
                    </span>
                  </div>
                  <div className="mt-[9px] text-[13.5px] leading-[1.55] text-[var(--v2-muted)]">
                    <B>sUSD is starting to drift.</B> Trading below intrinsic:
                    spread{" "}
                    {/* Was "+2.34%", which contradicted its own sentence
                        ("trading below intrinsic") AND the canonical sUSD row
                        in shared.tsx — same 0.9772/1.0006 scenario, holder
                        sign −234. Colour derives from that same bps so the
                        mock can never drift from the real convention. */}
                    <b className={cn("font-medium", v2SpreadSignClass(-234))}>
                      −2.34%
                    </b>{" "}
                    vs redemption value.
                  </div>
                  <div className="mt-2.5 flex items-center gap-2">
                    <StatePillV2 state="PEGGED" />
                    <span className="text-[var(--v2-dim)]">→</span>
                    <StatePillV2 state="DRIFT" />
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-[14px] border border-[var(--v2-line)] px-4 py-3 text-[13px] text-[var(--v2-muted)]">
                  <span>
                    SUBSCRIBE{" "}
                    <code className="font-mono text-[11.5px] text-[var(--v2-text)]">
                      wss://api.pegana.xyz/v1/peg/feed
                    </code>
                  </span>
                  <span className="inline-flex items-center gap-[5px] font-mono text-[10.5px] text-[var(--v2-peg)]">
                    ✓ live
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-[14px] border border-[var(--v2-line)] px-4 py-3 text-[13px] text-[var(--v2-muted)]">
                  <span>Payload includes</span>
                  <code className="font-mono text-[11.5px] text-[var(--v2-text)]">
                    state, spread_bps, receipt, methodology
                  </code>
                </div>
              </div>
            </div>
          </div>

          {/* api */}
          <div
            id="v2-pane-api"
            ref={apiPaneRef}
            role="tabpanel"
            aria-labelledby="v2-tab-api"
            hidden={tab !== "api"}
            className={paneShell}
          >
            <div className={paneTxt}>
              <h3 className="text-[23px] font-medium tracking-[-0.015em]">
                The same verdict, in your stack.
              </h3>
              <p className="mt-3 text-[15px] leading-[1.6] text-[var(--v2-muted)]">
                REST for a script, WebSocket for a stream, MCP for an agent. The
                API returns exactly what the board shows: state, spread, and the
                receipt that proves it.
              </p>
              <div className="mt-6 flex flex-col gap-3.5">
                <Check>
                  <B>REST + WebSocket</B>: keyless reads, 300 req/min
                </Check>
                <Check>
                  <B>MCP server</B>: native Model Context Protocol for agents
                </Check>
                <Check>
                  <B>Receipt in every response</B>: each answer carries its own
                  proof
                </Check>
              </div>
            </div>
            <div className={paneVis}>
              <div className={visCard}>
                <div className={vcHead}>
                  <span className="font-mono text-[12.5px]">
                    GET api.pegana.xyz/v1/assets/susd
                  </span>
                  <span className="flex items-center font-mono text-[11px] text-[var(--v2-dim)]">
                    200 · 38ms
                    <CopyButton
                      text="https://api.pegana.xyz/v1/assets/susd"
                      className="ml-2.5"
                    />
                  </span>
                </div>
                {/* tabIndex/role/label: a scrolling region with no focusable
                    child cannot be scrolled by keyboard (axe
                    `scrollable-region-focusable`, serious). */}
                <pre
                  tabIndex={0}
                  role="region"
                  aria-label="API response example"
                  className="overflow-x-auto whitespace-pre p-[18px] font-mono text-[12px] leading-[1.7] text-[var(--v2-text)]"
                >
                  {"{\n"}
                  <span className="text-[var(--v2-muted)]">{'  "symbol"'}</span>
                  {":      "}
                  <span className="text-[var(--v2-peg)]">{'"sUSD"'}</span>
                  {",\n"}
                  <span className="text-[var(--v2-muted)]">{'  "class"'}</span>
                  {":       "}
                  <span className="text-[var(--v2-peg)]">{'"yield_stable"'}</span>
                  {",\n"}
                  <span className="text-[var(--v2-muted)]">{'  "state"'}</span>
                  {":       "}
                  <span className="text-[var(--v2-depeg)]">{'"DRIFT"'}</span>
                  {",\n"}
                  <span className="text-[var(--v2-muted)]">{'  "spread_bps"'}</span>
                  {":  "}
                  <span className="text-[var(--v2-drift)]">234</span>
                  {",\n"}
                  <span className="text-[var(--v2-muted)]">{'  "market_usd"'}</span>
                  {":  "}
                  <span className="text-[var(--v2-drift)]">0.9772</span>
                  {",\n"}
                  <span className="text-[var(--v2-muted)]">{'  "intrinsic"'}</span>
                  {":   "}
                  <span className="text-[var(--v2-drift)]">1.0006</span>
                  {",\n"}
                  <span className="text-[var(--v2-muted)]">{'  "confidence"'}</span>
                  {":  "}
                  <span className="text-[var(--v2-peg)]">{'"high"'}</span>
                  {",\n"}
                  <span className="text-[var(--v2-muted)]">{'  "methodology"'}</span>
                  {": "}
                  <span className="text-[var(--v2-peg)]">{'"0.5.0"'}</span>
                  {",\n"}
                  <span className="text-[var(--v2-muted)]">{'  "receipt"'}</span>
                  {":     "}
                  <span className="text-[var(--v2-peg)]">{'"0x9f3a1d…c21b"'}</span>
                  {"\n}"}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
