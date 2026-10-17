"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useAppReducedMotion } from "@/lib/motion/use-reduced-motion";

export interface ChartFrame {
  /** Plotted points in canvas-pixel space, oldest -> newest. */
  pts: Array<[number, number]>;
  /** Y of the "intrinsic NAV" baseline. */
  base: number;
  w: number;
  h: number;
  /** Vertical scale applied to `dev * h` when placing each point. */
  scale: number;
}

export interface AssetChartCanvasHandle {
  /** Force-restart the draw-in animation (called when the tab becomes active). */
  restart: () => void;
  /** Latest drawn frame (for the hover-scrub overlay in ProductTabsV2). Kept
   *  on an internal ref rather than `window` (DESIGN.md port note). */
  getFrame: () => ChartFrame | null;
}

// Vertical scale for the illustrative line (DESIGN.md v5 r6.1 — 0.85 -> 0.62,
// narrower excursions read as "closer to intrinsic" and leave room for the
// drift-band reference line below).
const CHART_SCALE = 0.62;

// The product tab's asset-detail chart (DESIGN.md §4 "Chart draw-in"). This
// is the THIRD of the four sanctioned iridescent-gradient moments — "the
// gradient IS the measured data" — so the line and its fill keep the exact
// artifact gradient stops. Illustrative motion (draws once when it enters
// view, then a slow phase drift), not a literal plot of `/v1/assets/history`
// — the surrounding text (symbol, spread, market/intrinsic) binds to live
// data in ProductTabsV2; this canvas is the "data is alive" signature.
export const AssetChartCanvas = forwardRef<AssetChartCanvasHandle>(
  function AssetChartCanvas(_props, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const reduced = useAppReducedMotion();
    const startRef = useRef<(force?: boolean) => void>(() => {});
    const frameRef = useRef<ChartFrame | null>(null);

    useImperativeHandle(ref, () => ({
      restart: () => startRef.current(true),
      getFrame: () => frameRef.current,
    }));

    useEffect(() => {
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let w = 0;
      let h = 0;
      let ph = 1.2;
      let raf: number | null = null;
      let intro = 0;

      function size(): boolean {
        const r = c!.getBoundingClientRect();
        if (!r.width) return false;
        w = r.width;
        h = r.height;
        c!.width = w * dpr;
        c!.height = h * dpr;
        ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
        return true;
      }

      function draw() {
        ctx!.clearRect(0, 0, w, h);
        const base = h * 0.3;
        ctx!.strokeStyle = "rgba(255,255,255,.2)";
        ctx!.setLineDash([4, 5]);
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.moveTo(0, base);
        ctx!.lineTo(w, base);
        ctx!.stroke();
        ctx!.setLineDash([]);
        ctx!.fillStyle = "rgba(255,255,255,.35)";
        ctx!.font = "10px sans-serif";
        ctx!.fillText("intrinsic NAV", 6, base - 6);

        // Drift-band reference line — sample band boundary: the line's end
        // sits ~58% of the way there (matches the hero board's jitoSOL row).
        const bandY = base + 1.07 * h * CHART_SCALE;
        ctx!.strokeStyle = "rgba(232,112,137,.26)";
        ctx!.setLineDash([3, 6]);
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.moveTo(0, bandY);
        ctx!.lineTo(w, bandY);
        ctx!.stroke();
        ctx!.setLineDash([]);
        ctx!.fillStyle = "rgba(232,112,137,.6)";
        ctx!.textAlign = "right";
        ctx!.fillText("drift band", w - 6, bandY - 6);
        ctx!.textAlign = "left";

        const n = 72;
        const vis = Math.max(2, Math.floor(n * intro));
        const pts: [number, number][] = [];
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const x = t * w;
          const dev =
            Math.sin(t * 5 + ph) * 0.08 +
            Math.sin(t * 11 - ph * 0.7) * 0.045 +
            t * 0.62;
          pts.push([x, base + dev * h * CHART_SCALE]);
        }
        frameRef.current = { pts, base, w, h, scale: CHART_SCALE };
        const shown = pts.slice(0, vis + 1);

        const g = ctx!.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, "#ff8a5b");
        g.addColorStop(0.5, "#fb6fae");
        g.addColorStop(1, "#df91f7");

        ctx!.beginPath();
        ctx!.moveTo(0, base);
        for (const [x, y] of shown) ctx!.lineTo(x, y);
        ctx!.lineTo(shown[shown.length - 1][0], base);
        ctx!.closePath();
        const gf = ctx!.createLinearGradient(0, base, 0, h);
        gf.addColorStop(0, "rgba(251,111,174,.22)");
        gf.addColorStop(1, "rgba(223,145,247,.02)");
        ctx!.fillStyle = gf;
        ctx!.fill();

        ctx!.beginPath();
        shown.forEach(([x, y], j) =>
          j ? ctx!.lineTo(x, y) : ctx!.moveTo(x, y),
        );
        ctx!.strokeStyle = g;
        ctx!.lineWidth = 2.2;
        ctx!.lineJoin = "round";
        ctx!.stroke();

        const e = shown[shown.length - 1];
        ctx!.beginPath();
        ctx!.arc(e[0], e[1], 3.5, 0, 7);
        ctx!.fillStyle = "#df91f7";
        ctx!.shadowColor = "#e878d8";
        ctx!.shadowBlur = 12;
        ctx!.fill();
        ctx!.shadowBlur = 0;
      }

      function loop() {
        if (intro < 1) intro = Math.min(1, intro + 0.035);
        else ph += 0.005;
        draw();
        raf = requestAnimationFrame(loop);
      }

      function start(force?: boolean) {
        if (!size()) return;
        if (reduced) {
          intro = 1;
          draw();
          return;
        }
        if (force) intro = 0;
        if (raf) cancelAnimationFrame(raf);
        loop();
      }
      startRef.current = start;

      const onResize = () => {
        if (size() && reduced) {
          intro = 1;
          draw();
        }
      };
      window.addEventListener("resize", onResize);

      let io: IntersectionObserver | null = null;
      if (typeof IntersectionObserver !== "undefined" && !reduced) {
        io = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                start(true);
                io!.unobserve(c!);
              }
            });
          },
          { threshold: 0.3 },
        );
        io.observe(c);
      } else {
        start();
      }

      return () => {
        if (raf != null) cancelAnimationFrame(raf);
        window.removeEventListener("resize", onResize);
        io?.disconnect();
      };
    }, [reduced]);

    return <canvas ref={canvasRef} className="mt-3.5 h-[120px] w-full" />;
  },
);
