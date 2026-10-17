"use client";

import { useEffect, useRef } from "react";
import { useAppReducedMotion } from "@/lib/motion/use-reduced-motion";

// The hero's deepest layer (DESIGN.md r6, "the distance field"): 15 contour
// lines bending around a peg baseline, dipping under three gaussian "mass"
// points (the assets pulling away from peg) plus a pointer-reactive dip.
// Lines nearer the peg baseline are brighter — distance is the visual
// grammar, mirroring the reveal canvas's spotlight thesis one layer deeper.
// Verbatim port of the artifact's `#dfield` script (pegana-v5.html) adapted
// to React: same MASS array, same alpha/lineWidth formula, same static
// fallback under reduced-motion or <900px.
const MASS: Array<{ x: number; d: number; s: number; p: number }> = [
  { x: 0.22, d: 0.55, s: 0.1, p: 0 },
  { x: 0.58, d: 0.9, s: 0.075, p: 2.1 },
  { x: 0.84, d: 0.4, s: 0.12, p: 4.2 },
];

export function DistanceFieldCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduced = useAppReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const hero = canvas.closest("header");
    if (!hero) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let t = 0;
    let mx = -1;
    let my = -1;
    let cx = -1;
    let cy = -1;
    let raf: number | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function size(): boolean {
      const r = canvas!.getBoundingClientRect();
      if (!r.width) return false;
      w = r.width;
      h = r.height;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    }

    function draw() {
      ctx!.clearRect(0, 0, w, h);
      const peg = h * 0.44;
      const N = 15;
      const span = h * 0.052;
      for (let i = 0; i < N; i++) {
        const off = i - Math.floor(N / 2);
        const ly = peg + off * span;
        const near = 1 - Math.min(1, Math.abs(off) / 7);
        ctx!.strokeStyle = `rgba(255,255,255,${(0.016 + near * 0.034).toFixed(3)})`;
        ctx!.lineWidth = off === 0 ? 1.1 : 0.8;
        ctx!.beginPath();
        for (let k = 0; k <= 110; k++) {
          const u = k / 110;
          const x = u * w;
          let dip = 0;
          for (const m of MASS) {
            const dx = (u - m.x) / m.s;
            const amp = m.d * (0.85 + 0.15 * Math.sin(t * 0.7 + m.p));
            dip += amp * Math.exp(-dx * dx);
          }
          if (cx >= 0) {
            const pdx = (x - cx) / 150;
            const pdy = (ly - cy) / 220;
            const pd = pdx * pdx + pdy * pdy;
            dip += 0.5 * Math.exp(-pd);
          }
          // Below the peg the field sinks toward the band; above it stays taut.
          const pull = off >= 0 ? dip : dip * 0.35;
          const y = ly + pull * span * 1.6 * (off >= 0 ? 1 : -0.4);
          if (k === 0) ctx!.moveTo(x, y);
          else ctx!.lineTo(x, y);
        }
        ctx!.stroke();
      }
    }

    function loop() {
      t += 0.008;
      if (mx >= 0) {
        cx = cx < 0 ? mx : cx + (mx - cx) * 0.06;
        cy = cy < 0 ? my : cy + (my - cy) * 0.06;
      }
      draw();
      raf = requestAnimationFrame(loop);
    }

    function onMove(e: MouseEvent) {
      const r = canvas!.getBoundingClientRect();
      mx = e.clientX - r.left;
      my = e.clientY - r.top;
    }
    function onLeave() {
      mx = -1;
      my = -1;
      cx = -1;
      cy = -1;
    }

    function isStatic(): boolean {
      return reduced || window.innerWidth < 900;
    }

    function start() {
      if (!size()) {
        retryTimer = setTimeout(start, 120);
        return;
      }
      if (isStatic()) {
        draw();
        return;
      }
      hero!.addEventListener("mousemove", onMove);
      hero!.addEventListener("mouseleave", onLeave);
      raf = requestAnimationFrame(loop);
    }
    start();

    function onResize() {
      size();
      if (isStatic()) draw();
    }
    window.addEventListener("resize", onResize);

    return () => {
      if (raf != null) cancelAnimationFrame(raf);
      if (retryTimer != null) clearTimeout(retryTimer);
      hero!.removeEventListener("mousemove", onMove);
      hero!.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("resize", onResize);
    };
  }, [reduced]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 h-full w-full"
    />
  );
}
