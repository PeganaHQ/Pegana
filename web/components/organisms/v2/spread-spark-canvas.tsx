"use client";

import { useEffect, useRef } from "react";
import { useAppReducedMotion } from "@/lib/motion/use-reduced-motion";

export interface SpreadSparkCanvasProps {
  /** Spread series, oldest -> newest (left to right). Needs >= 2 points —
   *  callers render a "-" cell instead of mounting this when data is thin. */
  data: number[];
  /** Line/dot color literal (see `sparkColorHex` in shared.tsx). */
  color: string;
}

// Board "Spread · 24h" cell (DESIGN.md port, v5 r3 "tokens.xyz grammar" —
// the board is an instrument, not a picture). Draws once, 700ms, the first
// time it scrolls into view; recency fade (dim past -> solid present) reads
// left-to-right. A dedicated client leaf per row so each row's draw-in is
// independent. `data` is the inline `series_24h` already on the row (see
// BoardRow.spark) — this cell costs no requests of its own.
export function SpreadSparkCanvas({ data, color }: SpreadSparkCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduced = useAppReducedMotion();

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || data.length < 2) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const min = Math.min(...data);
    const max = Math.max(...data);
    // Span floor: pegged noise stays visually flat; only real drift fills
    // the cell (matches the artifact's `Math.max(max-min,1.5)`).
    const span = Math.max(max - min, 1.5);

    function draw(prog: number) {
      const r = c!.getBoundingClientRect();
      if (!r.width) return;
      c!.width = r.width * dpr;
      c!.height = 26 * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, r.width, 26);

      const vis = Math.max(2, Math.floor(data.length * prog));
      const g = ctx!.createLinearGradient(0, 0, r.width, 0);
      g.addColorStop(0, `${color}33`);
      g.addColorStop(0.55, `${color}99`);
      g.addColorStop(1, color);
      ctx!.strokeStyle = g;
      ctx!.globalAlpha = 1;
      ctx!.lineWidth = 1.25;
      ctx!.lineJoin = "round";
      ctx!.beginPath();
      for (let i = 0; i < vis; i++) {
        const px = (i / (data.length - 1)) * r.width;
        const py = 21 - ((data[i] - min) / span) * 16;
        if (i === 0) ctx!.moveTo(px, py);
        else ctx!.lineTo(px, py);
      }
      ctx!.stroke();

      if (prog >= 1) {
        const lx = r.width;
        const ly = 21 - ((data[data.length - 1] - min) / span) * 16;
        ctx!.globalAlpha = 1;
        ctx!.fillStyle = color;
        ctx!.beginPath();
        ctx!.arc(lx - 1.5, ly, 1.8, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    if (reduced) {
      draw(1);
      return;
    }

    let raf: number | null = null;
    let started = false;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !started) {
            started = true;
            io.disconnect();
            let t0: number | null = null;
            const step = (ts: number) => {
              if (t0 == null) t0 = ts;
              const p = Math.min(1, (ts - t0) / 700);
              draw(p);
              if (p < 1) raf = requestAnimationFrame(step);
            };
            raf = requestAnimationFrame(step);
          }
        }
      },
      { threshold: 0.2 },
    );
    io.observe(c);

    const onResize = () => draw(started ? 1 : 0);
    window.addEventListener("resize", onResize);

    return () => {
      io.disconnect();
      if (raf != null) cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [data, color, reduced]);

  return (
    <canvas ref={canvasRef} aria-hidden className="block h-[26px] w-full" />
  );
}
