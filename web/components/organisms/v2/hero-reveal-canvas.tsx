"use client";

import { useEffect, useRef } from "react";
import { useAppReducedMotion } from "@/lib/motion/use-reduced-motion";

// The hero's signature moment (DESIGN.md §4 "Reveal-mask hero bg"): faint
// market-noise ticks are always visible; a second offscreen layer (dotted
// grid + dashed "intrinsic 1.0000" baseline + mono micro-values) is masked by
// a radial spotlight that follows the cursor (or drifts in a Lissajous curve
// with no mouse). The spotlight is the thesis rendered as interaction: market
// price is only half the story.
//
// Isolated client leaf per DESIGN.md §8. Under reduced-motion or on
// touch-sized viewports (<900px) — no cursor to drive the reveal — the
// spotlight center is pinned to a fixed idle position and the whole scene is
// drawn once, statically, mirroring distance-field-canvas.tsx's
// isStatic()/draw-once fallback instead of leaving the canvas blank.
export function HeroRevealCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduced = useAppReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    const hero = canvas?.parentElement;
    if (!canvas || !hero) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const off = document.createElement("canvas");
    const offx = off.getContext("2d");
    if (!offx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let hh = 0;
    let mx = -1e4;
    let my = -1e4;
    let cx = -1e4;
    let cy = -1e4;
    let t = 0;
    let hasMouse = false;
    let noise: { x: number; y: number; l: number; a: number; s: number }[] = [];
    let raf: number | null = null;

    function size() {
      const r = hero!.getBoundingClientRect();
      w = r.width;
      hh = r.height;
      canvas!.width = w * dpr;
      canvas!.height = hh * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      off.width = w * dpr;
      off.height = hh * dpr;
      offx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      noise = [];
      const N = Math.min(90, Math.floor((w * hh) / 18000));
      for (let i = 0; i < N; i++) {
        noise.push({
          x: Math.random() * w,
          y: Math.random() * hh,
          l: Math.random() * 10 + 3,
          a: Math.random() * 0.4 + 0.1,
          s: (Math.random() - 0.5) * 0.1,
        });
      }
    }
    size();

    function onMove(e: MouseEvent) {
      const r = canvas!.getBoundingClientRect();
      mx = e.clientX - r.left;
      my = e.clientY - r.top;
      hasMouse = true;
    }
    function onLeave() {
      hasMouse = false;
    }

    function drawIntrinsic() {
      offx!.clearRect(0, 0, w, hh);
      offx!.strokeStyle = "rgba(245,245,246,.055)";
      offx!.lineWidth = 1;
      offx!.beginPath();
      for (let x = 0; x <= w; x += 26) {
        offx!.moveTo(x, 0);
        offx!.lineTo(x, hh);
      }
      for (let y = 0; y <= hh; y += 26) {
        offx!.moveTo(0, y);
        offx!.lineTo(w, y);
      }
      offx!.stroke();
      const base = hh * 0.62;
      offx!.strokeStyle = "rgba(245,245,246,.3)";
      offx!.setLineDash([5, 6]);
      offx!.beginPath();
      offx!.moveTo(0, base);
      offx!.lineTo(w, base);
      offx!.stroke();
      offx!.setLineDash([]);
      offx!.fillStyle = "rgba(245,245,246,.4)";
      offx!.font = '10.5px "Geist Mono", monospace';
      offx!.fillText("intrinsic 1.0000", 18, base - 9);
      offx!.fillText("NAV", w - 64, base - 9);
      offx!.fillStyle = "rgba(245,245,246,.22)";
      const microValues = ["+0.02%", "+0.41%", "1.0006", "0.9994"];
      for (let g = 0; g < 4; g++) {
        offx!.fillText(
          microValues[g],
          (0.16 + g * 0.22) * w,
          base + 26 + (g % 2) * 30,
        );
      }
      offx!.globalCompositeOperation = "destination-in";
      const grad = offx!.createRadialGradient(cx, cy, 0, cx, cy, 230);
      grad.addColorStop(0, "rgba(0,0,0,1)");
      grad.addColorStop(0.65, "rgba(0,0,0,.7)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      offx!.fillStyle = grad;
      offx!.fillRect(0, 0, w, hh);
      offx!.globalCompositeOperation = "source-over";
    }

    function isStatic(): boolean {
      return reduced || window.innerWidth < 900;
    }

    // Single static frame for reduced-motion / touch-sized viewports: pin the
    // spotlight to a fixed idle center (no cursor to drive it) and render the
    // noise ticks + masked reveal layer once, without entering the rAF loop.
    function drawStatic() {
      cx = w * 0.5;
      cy = hh * 0.42;
      ctx!.clearRect(0, 0, w, hh);
      ctx!.strokeStyle = "rgba(245,245,246,1)";
      for (const n of noise) {
        ctx!.globalAlpha = n.a * 0.16;
        ctx!.beginPath();
        ctx!.moveTo(n.x - n.l / 2, n.y);
        ctx!.lineTo(n.x + n.l / 2, n.y);
        ctx!.stroke();
      }
      ctx!.globalAlpha = 1;
      drawIntrinsic();
      ctx!.drawImage(off, 0, 0, w, hh);
    }

    function loop() {
      t += 0.005;
      let tx: number;
      let ty: number;
      if (hasMouse) {
        tx = mx;
        ty = my;
      } else {
        tx = w * (0.5 + 0.32 * Math.sin(t * 0.7));
        ty = hh * (0.42 + 0.22 * Math.sin(t * 1.13 + 1.7));
      }
      if (cx < -999) {
        cx = tx;
        cy = ty;
      }
      cx += (tx - cx) * 0.07;
      cy += (ty - cy) * 0.07;
      ctx!.clearRect(0, 0, w, hh);
      ctx!.strokeStyle = "rgba(245,245,246,1)";
      for (const n of noise) {
        n.x += n.s;
        if (n.x < -12) n.x = w + 12;
        if (n.x > w + 12) n.x = -12;
        ctx!.globalAlpha = n.a * 0.16;
        ctx!.beginPath();
        ctx!.moveTo(n.x - n.l / 2, n.y);
        ctx!.lineTo(n.x + n.l / 2, n.y);
        ctx!.stroke();
      }
      ctx!.globalAlpha = 1;
      drawIntrinsic();
      ctx!.drawImage(off, 0, 0, w, hh);
      raf = requestAnimationFrame(loop);
    }
    function start() {
      if (isStatic()) {
        drawStatic();
        return;
      }
      hero!.addEventListener("mousemove", onMove);
      hero!.addEventListener("mouseleave", onLeave);
      raf = requestAnimationFrame(loop);
    }
    start();

    function onResize() {
      size();
      if (isStatic()) drawStatic();
    }
    window.addEventListener("resize", onResize);

    return () => {
      if (raf != null) cancelAnimationFrame(raf);
      hero.removeEventListener("mousemove", onMove);
      hero.removeEventListener("mouseleave", onLeave);
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
