"use client";

import { useEffect, useRef } from "react";
import { useAppReducedMotion } from "@/lib/motion/use-reduced-motion";
import { useRevealV2 } from "@/lib/motion/use-reveal-v2";
import { PillGhost, PillPrimary } from "@/components/organisms/v2/shared";
import { DecorWaveSvg } from "@/components/organisms/v2/decor-wave";

// DESIGN.md §5.6 — the close: statement h2 + three ICP sentences + CTAs over
// the FOURTH sanctioned iridescent moment: two blurred wave-logo layers
// floating behind the CTA with a sine float + pointer-lerped parallax
// (opposite factors, rotate ±deg). Reduced-motion: waves render static.

export function CloseV2() {
  const reduced = useAppReducedMotion();
  const secRef = useRef<HTMLElement | null>(null);
  const w1Ref = useRef<SVGSVGElement | null>(null);
  const w2Ref = useRef<SVGSVGElement | null>(null);

  const h2 = useRevealV2<HTMLHeadingElement>({ index: 0 });
  const icp = useRevealV2<HTMLDivElement>({ index: 1 });
  const cta = useRevealV2<HTMLDivElement>({ index: 2 });

  useEffect(() => {
    if (reduced) return;
    const sec = secRef.current;
    const w1 = w1Ref.current;
    const w2 = w2Ref.current;
    if (!sec || !w1 || !w2) return;

    let mx = 0;
    let my = 0;
    let cx = 0;
    let cy = 0;
    let t = 0;
    let raf: number | null = null;

    function onMove(e: MouseEvent) {
      const r = sec!.getBoundingClientRect();
      mx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      my = ((e.clientY - r.top) / r.height - 0.5) * 2;
    }
    function onLeave() {
      mx = 0;
      my = 0;
    }
    sec.addEventListener("mousemove", onMove);
    sec.addEventListener("mouseleave", onLeave);

    function loop() {
      t += 0.008;
      cx += (mx - cx) * 0.06;
      cy += (my - cy) * 0.06;
      const f1y = Math.sin(t) * 14;
      const f2y = Math.sin(t * 0.72 + 1.4) * 11;
      w1!.style.transform = `translateX(calc(-50% + ${cx * 46}px)) translateY(${f1y + cy * 26}px) rotate(${cx * 2.2}deg)`;
      w2!.style.transform = `translateX(calc(-50% + ${cx * -30}px)) translateY(${f2y + cy * -18}px) rotate(${cx * -1.6}deg)`;
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    return () => {
      if (raf != null) cancelAnimationFrame(raf);
      sec.removeEventListener("mousemove", onMove);
      sec.removeEventListener("mouseleave", onLeave);
    };
  }, [reduced]);

  return (
    <section
      ref={secRef}
      className="relative overflow-hidden pb-[140px] pt-[150px] text-center"
    >
      <DecorWaveSvg
        ref={w1Ref}
        gradientId="v2-close-wave-1"
        className="pointer-events-none absolute bottom-[-320px] left-1/2 z-0 w-[1500px] opacity-[0.16] blur-[46px]"
      />
      <DecorWaveSvg
        ref={w2Ref}
        gradientId="v2-close-wave-2"
        className="pointer-events-none absolute bottom-[-180px] left-1/2 z-0 w-[1100px] opacity-[0.11] blur-[64px]"
      />
      {/* Momento 4 do gradiente (cenário do close), forma mobile: chroma
          radial behind the CTA, visible only under 760px where the desktop
          wave layers above are too large/off-screen to read as a moment. */}
      <div aria-hidden className="v2-close-mchroma" />
      <div className="relative z-[2] mx-auto max-w-[1180px] px-6 sm:px-10">
        <h2
          ref={h2.ref}
          style={h2.style}
          className="mx-auto max-w-[30ch] text-balance text-[clamp(32px,4.8vw,54px)] font-medium leading-[1.06] tracking-[-0.022em]"
        >
          See peg risk the way the people who carry it do.
        </h2>
        {/* One universal line — no per-audience segmentation, smaller and
            complete (Rafael 2026-07-16): every asset, vs intrinsic, one feed,
            a signed receipt the moment one breaks. */}
        <div
          ref={icp.ref}
          style={icp.style}
          className="mx-auto mt-[22px] max-w-[76ch] text-balance text-[15.5px] leading-[1.55] text-[var(--v2-muted)] sm:text-[16px]"
        >
          Every pegged asset in one live feed, measured against its own
          intrinsic value. With a signed, replayable receipt the moment
          one breaks, before it&rsquo;s a headline.
        </div>
        <div
          ref={cta.ref}
          style={cta.style}
          className="mt-[28px] flex flex-wrap justify-center gap-3 max-[759px]:mx-auto max-[759px]:max-w-[340px] max-[759px]:flex-col max-[759px]:items-stretch max-[759px]:gap-2.5"
        >
          <PillPrimary href={"/dashboard"}>open the dashboard</PillPrimary>
          <PillGhost href="https://docs.pegana.xyz/guides/rest-api">assets api</PillGhost>
        </div>
      </div>
    </section>
  );
}
