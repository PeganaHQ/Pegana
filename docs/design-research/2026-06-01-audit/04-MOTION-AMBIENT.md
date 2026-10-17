# 04 — Motion & Ambient System

**pegana.xyz redesign · master design-spec series**
Status: decision-ready · Canvas: pure black `#000` · Peers: Phantom / Base / Helius
Source of truth for tokens: `web/app/globals.css` · Brand authority: `brand.md`

This document specifies four things:

1. The iridescent **living-gradient ambient** — how to build a restrained, premium animated background for hero moments using only our ammunition colors, with the chosen tech, perf budget, and a static reduced-motion fallback.
2. The full **motion timing / easing system** — durations, easings, and where each applies, reconciled to the brand `globals.css` and the craft table.
3. **Reveal-on-scroll + smooth-scroll** — IntersectionObserver for reveals, Lenis for normalized scroll, with Next 16 client-boundary rules.
4. The rule that keeps iridescent **ammunition, not decoration**.

Everything below is buildable. Tokens, `clamp()` sizes, timings, and component signatures are real and reconcile to what already ships (`MouseSpotlight`, `DottedGridBg`, `.text-iridescent`, `--ease-default`, `--ease-out-strong`).

> **Non-negotiable framing.** None of this is a terminal, a Bloomberg console, or a CRT. There are no scanlines, no flicker, no glow halos around text, no phosphor green, no noise-as-monitor-texture. The ambient is the single editorial "something alive" moment Phantom / Base / Helius all use — a color-temperature source on a dark canvas, not a wallpaper and not a screensaver.

---

## 0 · Token additions (add to `web/app/globals.css` `@theme`)

The brand already defines `--ease-default`, `--ease-out-strong`, the surface ladder, and `--gradient-iridescent`. The motion system needs a small, explicit duration + ambient ladder so no component reaches for a Tailwind default (`duration-300`, `ease-in-out`) ever again.

```css
@theme {
  /* ── Easing (already present — restated for completeness) ───────── */
  --ease-default:     cubic-bezier(0.22, 1, 0.36, 1);   /* the workhorse  */
  --ease-out-strong:  cubic-bezier(0.16, 1, 0.3, 1);    /* big entrances  */
  --ease-overshoot:   cubic-bezier(0.34, 1.4, 0.64, 1); /* card lift only */

  /* ── Duration ladder (NEW — bind every transition to one of these) ─ */
  --dur-color:    0.12s;  /* color swap, active-state opacity         */
  --dur-button:   0.15s;  /* button bg fill, toggle indicator slide   */
  --dur-lift:     0.2s;   /* hover lift, underline reveal, border swap */
  --dur-card:     0.35s;  /* card lift (paired with --ease-overshoot)  */
  --dur-reveal:   0.7s;   /* reveal-on-scroll fade-up                  */
  --dur-entrance: 0.8s;   /* hero headline / big section entrance      */
  --dur-canvas:   1.2s;   /* ambient/canvas fade-in on mount          */

  /* ── Ambient timing (NEW — environmental, slower than interactive) ─ */
  --amb-orb-cycle:   25s;     /* bokeh orb drift                       */
  --amb-shader-step: 0.0008;  /* uTime increment / frame (~75s cycle)  */

  /* ── Iridescent RGB stops (NEW — for rgba() ambient washes) ──────── */
  --iri-amber:  254, 237, 122;  /* #feed7a */
  --iri-orange: 255, 132, 0;    /* #ff8400 */
  --iri-violet: 223, 145, 247;  /* #df91f7 */
}
```

Rationale: the brand motion section says "200–300ms `var(--ease-default)`" but that range is too loose to keep AI-template timings (`300/500/1000ms`) out of components. The ladder above collapses that range into named intents. **No transition in the codebase should use a raw `ms` value that is not one of these tokens.**

---

## 1 · Iridescent living-gradient ambient

### 1.1 What it is

A single color-temperature source above the hero headline that makes pure-black `#000` feel like it has depth behind it — the move Base.org and Phantom use. It is **not** a full-bleed mesh that competes with type. It is the approved **hero spotlight** ammunition usage, optionally elevated to a slow living wash on capable devices.

The system has three layers, stacked back-to-front, all behind content:

| z | Layer | Tech | Animates? |
|---|---|---|---|
| `0` | Hero spotlight radial | CSS `background` on hero `<section>` | No (static) |
| `0` | Ambient bokeh orbs (2) | CSS `filter: blur()` divs | Slow drift, 25s |
| `-1` | Living shader wash (optional, v1.1+) | R3F `<canvas fixed inset-0>` | Yes, `uTime` |
| `1`–`n` | Content (headline, sub, CTAs) | — | Reveal-on-scroll |

> **Existing code to reconcile.** `MouseSpotlight` (`web/components/molecules/mouse-spotlight.tsx`) already renders a mouse-tracked iridescent radial at `z-[1]` with `mix-blend-screen` using the exact amber/orange/violet stops. The hero spotlight below is the **static, headline-anchored** counterpart. Both are legitimate iridescent usages (hero spotlight). Do **not** run both at full intensity in the same viewport — if `MouseSpotlight` is active on the hero, drop the static spotlight opacity by ~30% so they don't sum to a hot blob. They share the same palette so they read as one light source.

### 1.2 Tech decision — shader vs canvas vs CSS

| Approach | Fidelity | Cost | Next 16 fit | Verdict |
|---|---|---|---|---|
| **CSS** radial-gradient + bokeh + `@keyframes` | Premium-static, good drift | ~0% CPU, GPU-composited | RSC-safe, zero JS | **SHIP NOW (default)** |
| **Canvas 2D** lerping blobs | Mid; organic but JS frame loop | CPU frame loop, cap 30fps | needs `'use client'` | Skip — worst ratio |
| **WebGL / R3F** GLSL mesh | Highest; organic continuous flow | ~1.5ms/frame on M1 @ dpr 1.5 | `'use client'` + `dynamic(ssr:false)` | **v1.1+ only, gated** |

**Decision: CSS-only is the v1 default.** Reasons:

1. The brand's signature is *restraint*. A static iridescent spotlight on pure black is already the Base/Phantom move — adding a continuously-morphing mesh risks the "screensaver" register the brand explicitly rejects.
2. CSS costs zero JS, has no `'use client'` boundary, doesn't touch LCP, and degrades to a beautiful static frame under reduced-motion for free.
3. The shader path is real and validated (R3F 9.6.1 / three 0.184.0, `flat` Canvas, `dpr={[1,1.5]}`, 2-octave noise + grain) but it is **complexity you adopt only after the CSS direction is verified in prod.** The landing redesign is paused per the handoff note — do not introduce WebGL before the simpler direction ships and is reviewed.

The shader spec is included in §1.6 as a ready-to-build option for when the redesign resumes, but it carries a brand-exception bar: it must be reviewed against the "ammunition, not decoration" rule (§4) before merge.

### 1.3 Layer A — Hero spotlight (CSS, ship now)

The single biggest visual delta for zero JS. Add to the hero `<section>` wrapper in `web/app/(marketing)/page.tsx`.

```tsx
// Hero section wrapper — the spotlight is a pseudo-element so it never
// participates in layout and is trivially reduced-motion / theme aware.
<section className="relative isolate overflow-hidden">
  {/* Spotlight: warm amber at top-center bleeding through orange to a
      violet fringe, then transparent into the #000 canvas. Static. */}
  <div
    aria-hidden
    className="pointer-events-none absolute inset-0 -z-10 opacity-0 hero-spotlight"
  />
  {/* …headline, sub, CTAs… */}
</section>
```

```css
.hero-spotlight {
  background: radial-gradient(
    ellipse 80% 60% at 50% 0%,
    rgba(var(--iri-amber),  0.13) 0%,
    rgba(var(--iri-orange), 0.08) 35%,
    rgba(var(--iri-violet), 0.06) 60%,
    transparent 100%
  );
  /* Canvas fade-in from the motion table (1.2s) on first paint. */
  animation: spotlight-in var(--dur-canvas) var(--ease-out-strong) forwards;
}

@keyframes spotlight-in { to { opacity: 1; } }

@media (prefers-reduced-motion: reduce) {
  /* Show the spotlight immediately, fully — the static frame is the point. */
  .hero-spotlight { animation: none; opacity: 1; }
}
```

Opacities are deliberately low (6–13%): the canvas must still read as pure black with a *temperature*, not a colored panel. No white glow, no blue glow — amber → orange → violet only.

### 1.4 Layer B — Ambient bokeh orbs (CSS, ship now)

Two heavily-blurred orbs in the **periphery** that suggest the hero light bleeds into the next section. They never overlap headline or CTA. This is `brandFit: adapt` — adopted, but constrained to two orbs total and to margins.

```tsx
// Place at the hero→first-section seam. aria-hidden, never interactive.
<div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
  <div className="ambient-orb ambient-orb--warm" />
  <div className="ambient-orb ambient-orb--violet" />
</div>
```

```css
.ambient-orb {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  filter: blur(80px);
  will-change: transform;        /* promote to its own GPU layer        */
  contain: paint;                /* isolate repaint scope from siblings */
}
.ambient-orb--warm {
  width: 480px; height: 480px;
  background: radial-gradient(circle, rgba(var(--iri-orange), 0.10) 0%, transparent 70%);
  bottom: -10%; right: -5%;
}
.ambient-orb--violet {
  width: 360px; height: 360px;
  background: radial-gradient(circle, rgba(var(--iri-violet), 0.09) 0%, transparent 70%);
  top: 18%; left: -8%;
}

@media (prefers-reduced-motion: no-preference) {
  .ambient-orb { animation: orb-drift var(--amb-orb-cycle) ease-in-out infinite; }
  .ambient-orb--violet { animation-delay: -8s; } /* desync the two */
}
@keyframes orb-drift {
  0%, 100% { transform: translate(0, 0); }
  50%      { transform: translate(20px, -30px); }
}
```

Note: the orb drift cycle (`25s`) is intentionally **slower than any value in the brand motion table.** Ambient motion is environmental, not interactive — it should sit below conscious perception. The static position is already beautiful, so the global reduced-motion guard in `globals.css` (which already sets `animation-duration: 0.001ms`) is a correct fallback; the orbs simply freeze in place.

### 1.5 Layer C scope — grainy iridescent foil (SVG, ship now, **scoped**)

The "foil" texture is what kills the screensaver quality — but it is **scoped to iridescent elements only**, never the canvas (canvas-wide grain *is* the forbidden CRT noise). Define the filter once, apply it via CSS `filter: url(#iri-grain)` to the hero headline `<span class="text-iridescent">` and the primary CTA fill.

```tsx
// Render once near the top of the marketing page (or in the root layout).
// display:none keeps it out of layout; the filter is referenceable globally.
<svg width="0" height="0" aria-hidden focusable="false" style={{ position: "absolute" }}>
  <filter id="iri-grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.65"
                  numOctaves="3" stitchTiles="stitch" result="noise" />
    <feColorMatrix in="noise" type="saturate" values="0" result="mono" />
    <feComponentTransfer in="mono" result="grain">
      <feFuncA type="linear" slope="0.35" intercept="0" />  {/* ~35% foil */}
    </feComponentTransfer>
    <feBlend in="SourceGraphic" in2="grain" mode="overlay" result="blend" />
    <feComposite in="blend" in2="SourceGraphic" operator="in" /> {/* clip to shape */}
  </filter>
</svg>
```

```css
/* The existing .text-iridescent class already does background-clip:text.
   Layer grain ON TOP, clipped to the letterforms. */
.text-iridescent { filter: url(#iri-grain); }

/* Primary CTA: grain at rest, removed on hover so the gradient breathes. */
[data-cta="primary"] { filter: url(#iri-grain); transition: filter var(--dur-lift) var(--ease-default); }
[data-cta="primary"]:hover { filter: none; }
```

**Scope lock (hard rule):** `filter: url(#iri-grain)` may touch **only** elements that carry the iridescent gradient — the hero headline span, the primary CTA fill, the BrandMark dot, and (if it uses the iridescent palette) the hero spotlight. Applying it to the canvas, surface cards, body copy, nav, or tables is a CRT-noise violation and an automatic fail.

> Reduced-motion: the grain is static (turbulence is not animated), so it needs no guard. If a future iteration animates `baseFrequency` for shimmer, that animation must move into a `prefers-reduced-motion: no-preference` block — but the recommendation is to keep it static; animated grain drifts toward CRT.

### 1.6 Layer D — Living shader wash (R3F, **v1.1+, gated, optional**)

Build only after the CSS direction ships and is reviewed. This is the ShaderGPT-style continuous wash, kept restrained: 2-octave noise, our four stops (three iridescent + one `#0a0a0a` dark pool so the gradient breathes between color and near-black).

**Install:** `bun add three @react-three/fiber @react-three/drei @types/three`
**Files:**
- `web/components/ambient/ambient-gradient.tsx` — `'use client'`, the `<Canvas>` + shader mesh.
- `web/components/ambient/ambient-gradient-static.tsx` — the CSS fallback (re-export of §1.3 spotlight markup).
- `web/components/ambient/index.tsx` — picks the variant by `matchMedia` **before mount**.

```tsx
// index.tsx — choose variant at module/runtime, never mount-then-pause.
"use client";
import dynamic from "next/dynamic";
import { AmbientGradientStatic } from "./ambient-gradient-static";

const AmbientGradientGL = dynamic(
  () => import("./ambient-gradient").then((m) => m.AmbientGradientGL),
  { ssr: false, loading: () => <AmbientGradientStatic /> }, // SSR-safe, no WebGL on server
);

export function AmbientGradient() {
  // Read the OS preference synchronously on the client before deciding to
  // mount the Canvas at all — mounting then pausing can still jank.
  if (typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return <AmbientGradientStatic />;
  }
  return <AmbientGradientGL />;
}
```

```tsx
// ambient-gradient.tsx — 'use client'
"use client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import { useRef, useMemo } from "react";
import * as THREE from "three";

const frag = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2  uRes;
  varying vec2  vUv;
  // amber / orange / violet / dark-pool (#0a0a0a) — the ONLY four stops.
  const vec3 A = vec3(0.996, 0.906, 0.478);
  const vec3 O = vec3(1.000, 0.518, 0.000);
  const vec3 V = vec3(0.875, 0.569, 0.969);
  const vec3 D = vec3(0.039, 0.039, 0.039);
  void main() {
    vec2 uv = vUv;
    float t = uTime;
    float a = 0.5 + 0.5 * sin(t * 0.7 + uv.x * 3.1 + uv.y * 1.7);
    float b = 0.5 + 0.5 * sin(t * 0.5 - uv.y * 2.3 + 1.7);
    vec3 col = mix(D, A, a * 0.30);          // breathe between dark and amber
    col = mix(col, O, b * 0.22);
    col = mix(col, V, (a * b) * 0.18);
    // fine foil grain, reseeded ~24fps, ~4% — reads as premium, not CRT.
    float g = fract(sin(dot(uv * floor(t * 24.0), vec2(127.1, 311.7))) * 43758.5);
    col += (g - 0.5) * 0.04;
    gl_FragColor = vec4(col, 1.0);
  }`;

const vert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function Plane() {
  const ref = useRef<THREE.ShaderMaterial>(null!);
  const size = useThree((s) => s.size);
  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uRes: { value: new THREE.Vector2(size.width, size.height) } }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useFrame(({ clock }) => { ref.current.uniforms.uTime.value = clock.elapsedTime; });
  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial ref={ref} fragmentShader={frag} vertexShader={vert} uniforms={uniforms} />
    </mesh>
  );
}

export function AmbientGradientGL() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[-1]">
      <Canvas flat dpr={[1, 1.5]} frameloop="always"
              gl={{ antialias: false, alpha: false }}
              style={{ opacity: 0, animation: "spotlight-in var(--dur-canvas) var(--ease-out-strong) forwards" }}>
        <PerformanceMonitor onDecline={() => {/* drop dpr / disable */}} />
        <Plane />
      </Canvas>
    </div>
  );
}
```

**Shader gotchas (validated):** `flat` is mandatory (default ACESFilmic tonemapping crushes dark gradient midtones and shifts hue); clamp `dpr={[1,1.5]}` (never raw `devicePixelRatio` — a 3× Retina panel renders 4320px and kills frame time); use `clock.elapsedTime` (absolute) not summed delta (delta drifts when the tab throttles RAF); add a `visibilitychange` listener that calls `gl.setAnimationLoop(null)` on hide to stop GPU work in background tabs; `z-[-1]` not `z-0` (Tailwind v4 stacking-context resets differ). Scale grain UV by dpr so foil stays ~1px on Retina. Keep to **two octaves** — three/four are exponential cost for visually-indistinguishable ambient.

### 1.7 Perf budget

| Path | CPU | GPU | LCP impact |
|---|---|---|---|
| Hero spotlight (CSS) | 0% | composited, ~0 | None (paint only) |
| Bokeh orbs (CSS blur) | 0% (GPU-promoted via `will-change`) | small, isolated by `contain: paint` | None |
| SVG `#iri-grain` | 0% | one-time filter raster per element | Negligible (≤4 small elements) |
| Shader wash (R3F, v1.1+) | ~0% JS | ~1.5ms/frame @ M1 dpr 1.5 (<<16ms) | mount after LCP via `dynamic`/fade-in |

Hard caps: blur orbs capped at **two**; reduce orb opacity to `0.15` of base and disable orb animation on `(max-width: 640px)` to spare mobile battery on blur compositing. The shader (if built) fades in *after* first paint via `dynamic(ssr:false)` + the `1.2s` opacity entrance, so it never blocks LCP.

### 1.8 Reduced-motion fallback (the static frame must look intentional)

| Layer | `prefers-reduced-motion: reduce` |
|---|---|
| Hero spotlight | `animation: none; opacity: 1` — appears instantly, full strength |
| Bokeh orbs | freeze in place (global guard handles it); static positions are already composed |
| SVG grain | unaffected (static by design) |
| Shader wash | **never mount the Canvas** — `index.tsx` returns `<AmbientGradientStatic />` |

The global guard already in `globals.css` (`@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.001ms; transition: none; } }`) covers the CSS layers automatically. The only manual work is the shader branch in `index.tsx`.

---

## 2 · Motion timing & easing system

### 2.1 The three easings (no springs, ever)

| Token | Curve | Use |
|---|---|---|
| `--ease-default` | `cubic-bezier(0.22, 1, 0.36, 1)` | Everything interactive: color/bg/border swaps, underline reveal, ghost hover, reveal-on-scroll. |
| `--ease-out-strong` | `cubic-bezier(0.16, 1, 0.3, 1)` | Big entrances: hero headline, large section reveals, ambient fade-in, count-up. |
| `--ease-overshoot` | `cubic-bezier(0.34, 1.4, 0.64, 1)` | **Card lift only.** Slight over-travel = physical responsiveness without spring physics. |

Brand rule: "Ease only, no springs. Financial data ≠ toy physics." The overshoot curve is the *one* place we allow a touch of bounce — and it is a Bézier, not a spring (`stiffness`/`damping`/`mass` remain forbidden).

### 2.2 The duration ladder (reconciled to the craft table)

| Duration token | Value | Easing | Applies to |
|---|---|---|---|
| `--dur-color` | `0.12s` | `--ease-default` | Color swap; active/press opacity; price cross-fade on a toggle |
| `--dur-button` | `0.15s` | `--ease-default` | Button background fill; toggle indicator slide |
| `--dur-lift` | `0.2s` | `--ease-default` | Hover lift (`translateY(-1px)`); underline `scaleX`; border-color swap; grain-off on CTA hover |
| `--dur-card` | `0.35s` | `--ease-overshoot` | Card lift (`translateY(-3px)` + border brighten) |
| `--dur-reveal` | `0.7s` | `--ease-default` | Reveal-on-scroll fade-up; section blur-crossfade |
| `--dur-entrance` | `0.8s` | `--ease-out-strong` | Hero headline / sub / CTA staggered entrance; count-up |
| `--dur-canvas` | `1.2s` | `--ease-out-strong` | Ambient spotlight / shader / canvas fade-in on mount |

**Banned values:** `300ms`, `500ms`, `1000ms`, `ease`, `ease-in-out`, `linear` (except the slow iridescent shimmer, see §4). The current `globals.css` `button, a` transition block uses `200ms` — that maps to `--dur-lift`; migrate it to the token. The header underline currently uses `duration-500` per the navbar scout note — tighten to `--dur-lift` (`0.2s`).

### 2.3 Where each pattern applies (component-level)

**Ghost-pill CTA** — two properties transition together (the premium tell vs. single-property generic):
```tsx
<Link
  data-cta="ghost"
  className="rounded-full border border-outline px-7 py-3.5 text-[13px] text-text
             transition-[border-color,background-color,transform]
             duration-[200ms] ease-[cubic-bezier(0.22,1,0.36,1)]
             hover:border-text hover:bg-text/[0.04]
             active:bg-text/[0.08] active:scale-[0.985]">
  Open the dashboard <span aria-hidden>→</span>
</Link>
```
> Prefer the tokenized form `transition-[border-color,background-color,transform] [transition-duration:var(--dur-lift)] [transition-timing-function:var(--ease-default)]` once the duration ladder lands; the inline cubic-bezier above is shown for clarity.

**Primary iridescent pill** — never transition the gradient itself (re-paint jank). Transition `opacity` and `transform` only; the gradient is static, the shimmer (if used) is a separate `background-position` animation (§4):
```tsx
<Link
  data-cta="primary"
  className="rounded-full px-7 py-3.5 text-[13px] font-semibold text-canvas
             transition-[opacity,transform] duration-[150ms]
             hover:opacity-90 active:scale-[0.98] active:opacity-85"
  style={{ background: "var(--gradient-iridescent)" }}>
  Read the API <span aria-hidden>→</span>
</Link>
```
The existing `globals.css` `[data-cta="primary"]:hover` glow (`box-shadow: 0 0 40px -4px rgba(255,132,0,0.4)…`) is an approved iridescent-palette glow on an iridescent element — keep it, it is on the ammunition list (it's the CTA's own light).

**Card lift (no shadow on dark canvas):**
```css
.card {
  border: 1px solid var(--color-hairline);
  transition: transform var(--dur-card) var(--ease-overshoot),
              border-color var(--dur-lift) var(--ease-default);
}
.card:hover { transform: translateY(-3px); border-color: var(--color-outline); }
/* state-pip cards brighten to the semantic color on hover: */
.card[data-state="pegged"]:hover {
  border-color: color-mix(in srgb, var(--color-st-pegged) 40%, transparent);
}
```
No `box-shadow` (it vanishes or muddies on `#000`); 0px radius (sharp = structure).

**Data-row left-edge accent (coral or state color):**
```css
.data-row { position: relative; overflow: hidden; }
.data-row::before {
  content: ""; position: absolute; inset: 0 auto 0 0; width: 2px;
  background: var(--color-coral); transform: scaleX(0); transform-origin: left;
  transition: transform var(--dur-lift) var(--ease-default);
}
.data-row:hover::before { transform: scaleX(1); }
.data-row[data-state="drift"]::before { background: var(--color-st-drift); }
```

**Count-up on viewport entry** (mono, tabular, no reflow) — `--dur-entrance` (`0.8s`), ease ≈ `ease-out-strong`, triggered once via IO then `unobserve`:
```ts
function countUp(el: HTMLElement, target: number, ms = 800) {
  const decimals = (String(target).split(".")[1] ?? "").length;
  const t0 = performance.now();
  requestAnimationFrame(function tick(now) {
    const t = Math.min((now - t0) / ms, 1);
    const e = 1 - Math.pow(1 - t, 4);            // ≈ cubic-bezier(0.16,1,0.3,1)
    el.textContent = (target * e).toFixed(decimals);
    if (t < 1) requestAnimationFrame(tick);
  });
}
// element: font-family var(--font-mono); font-variant-numeric: tabular-nums;
// reduced-motion: skip — set el.textContent = String(target) immediately.
```
Brand caveat: count-up is for *marketing* stat strips only. Do **not** animate live peg numbers, prices, or the metrics strip that reads as factual evidence — those snap to value (the brand rejects "sparkline/number as decoration").

### 2.4 framer/motion vs. CSS — the boundary

Per the brand: **reveal-on-scroll is IntersectionObserver + CSS, not framer-motion.** framer/motion is reserved for *true interactions* — drag, layout (FLIP) transitions, `AnimatePresence` route/modal exit, shared-element `layoutId`. The project pins `framer-motion@11.18.2`; the v12 upgrade is non-breaking for these APIs (read the v12 changelog for the easing-name rename first). When framer is used:

- Wrap the app once in `<MotionConfig reducedMotion="user">` (a `'use client'` shell at the root). Note: this suppresses *transform* props only — gate opacity-heavy effects manually with `useReducedMotion()`.
- All `motion.*`, `useScroll`, `useTransform`, `useReducedMotion` live behind `'use client'`. Export pre-built wrappers from `web/components/motion/` so RSC pages stay server-only.
- Animate `style` MotionValues, never Tailwind `className` (utilities are static; animating classes does nothing under MotionValues).

---

## 3 · Reveal-on-scroll + smooth-scroll

### 3.1 Reveal-on-scroll — IntersectionObserver + CSS (not framer)

One observer, CSS does the animation. Paint-thread-safe, 60fps on low-end hardware. Travel is **7px** (not the generic 40px) and stagger is **40–60ms** (not 300ms) — the tight interval reads as a choreographed wave, not a loading glitch.

```css
.reveal {
  opacity: 0;
  transform: translateY(7px);
  transition: opacity var(--dur-reveal) var(--ease-default),
              transform var(--dur-reveal) var(--ease-default);
  transition-delay: var(--reveal-delay, 0s);   /* per-child stagger */
}
.reveal.is-visible { opacity: 1; transform: none; }

/* Optional "coming into focus" variant for long dense pages (methodology). */
.section-reveal {
  opacity: 0.15; filter: blur(4px); transform: translateY(6px);
  transition: opacity var(--dur-reveal) var(--ease-default),
              filter  var(--dur-reveal) var(--ease-default),
              transform var(--dur-reveal) var(--ease-default);
  will-change: opacity, transform;   /* NOT filter — promoting filter explodes layers */
}
.section-reveal.is-visible { opacity: 1; filter: blur(0); transform: none; }

@media (prefers-reduced-motion: reduce) {
  .reveal, .section-reveal {
    transition: none !important;
    opacity: 1 !important; filter: none !important; transform: none !important;
  }
}
```

```tsx
// web/components/motion/reveal-observer.tsx — 'use client'
"use client";
import { useEffect } from "react";

export function RevealObserver() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".reveal, .section-reveal");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);          // reveal once, then release
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -48px 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return null;
}
```

Stagger is set inline per child, capped at `0.30s` total for lists > 6 items:
```tsx
{items.map((item, i) => (
  <li key={item.id} className="reveal"
      style={{ "--reveal-delay": `${Math.min(i * 0.05, 0.3)}s` } as React.CSSProperties}>
    …
  </li>
))}
```

Next 16 boundary: `RevealObserver` is a leaf `'use client'` component dropped once into the marketing layout (or each page). The sections it observes stay **RSC** — the observer only reads/mutates `classList` after hydration, so server-rendered markup is untouched and there's no hydration mismatch.

### 3.2 Smooth scroll — Lenis (with GSAP only if/when ScrollTrigger is needed)

`html { scroll-behavior: smooth }` already exists in `globals.css` for anchor jumps. For premium momentum on the marketing surface, add **Lenis** as a scroll normalizer. Lenis is accessibility-safe (it only normalizes wheel/touch), so it runs even under reduced-motion — **only decorative GSAP animations get gated, never Lenis itself.**

```tsx
// web/components/motion/smooth-scroll-provider.tsx — 'use client'
"use client";
import { ReactLenis } from "lenis/react";
import "lenis/dist/lenis.css";          // required — fixes iOS overscroll fighting Lenis

export function SmoothScrollProvider({ children }: { children: React.ReactNode }) {
  return (
    <ReactLenis root options={{ autoRaf: true, lerp: 0.1 }}>
      {children}
    </ReactLenis>
  );
}
```

Drop it just inside the root `layout.tsx` body so all marketing pages inherit it. Children stay RSC underneath the `'use client'` provider. Add `data-lenis-prevent` to any modal/drawer/nested scrollable so smooth scroll releases inside them.

**If (and only if) the redesign adds scrubbed/pinned scroll choreography** (e.g. the footer PEGANA wordmark parallax in the scout notes), switch to manual RAF so Lenis and GSAP ScrollTrigger share one loop:

```tsx
"use client";
import { ReactLenis, useLenis } from "lenis/react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
gsap.registerPlugin(ScrollTrigger, useGSAP);

// In a 'use client' provider: autoRaf:false, then drive one loop —
//   const lenis = useLenis();
//   useEffect(() => {
//     if (!lenis) return;
//     lenis.on("scroll", ScrollTrigger.update);
//     gsap.ticker.add((t) => lenis.raf(t * 1000));
//     gsap.ticker.lagSmoothing(0);            // AFTER add(), BEFORE any ScrollTrigger.create()
//     return () => { gsap.ticker.remove(/* fn */); };
//   }, [lenis]);
```

GSAP gotchas (validated): `autoRaf:false` when sharing with the GSAP ticker; `lagSmoothing(0)` after `ticker.add()` and before any `ScrollTrigger.create()` or it jitters; never put `registerPlugin`/`new Lenis()` at module top-level in an RSC file; use `gsap.matchMedia()` (not the deprecated `ScrollTrigger.matchMedia()`) to split full animations (`(prefers-reduced-motion: no-preference)`) from a fade-only fallback (`reduce`); `useGSAP(fn, { scope: ref })` auto-reverts on unmount and is SSR-safe via isomorphic layout effect.

**Recommendation:** ship §3.2's simple `ReactLenis root autoRaf` first. Only adopt the manual-loop + GSAP variant when a concrete scrubbed effect (wordmark parallax) is actually being built — don't pull GSAP in speculatively.

---

## 4 · The rule: iridescent is ammunition, not decoration

The iridescent gradient `linear-gradient(90deg, #feed7a 0%, #ff8400 50%, #df91f7 100%)` is the **single signature accent.** Every additional usage dilutes it. The brand defines an exact allow-list; this doc adds the motion/ambient corollaries.

### 4.1 The complete allow-list (iridescent may appear ONLY here)

| # | Surface | Form | Motion allowed |
|---|---|---|---|
| 1 | BrandMark dot | gradient fill | none (static) |
| 2 | Primary CTA pill | gradient fill | `background-position` shimmer (slow, see §4.3); own glow on hover |
| 3 | Hero spotlight | low-opacity radial wash | `1.2s` fade-in on mount; static thereafter |
| 4 | Hero headline accent `<span class="text-iridescent">` | `background-clip: text` | optional slow shimmer (§4.3) |
| 5 | Methodology variable underlines | SVG `stroke` | reveal draw-on (one-time) |
| 6 | Footer iri-thread | thin gradient line | none / slow drift |
| 7 | Ambient bokeh orbs (periphery) | blurred radial, iridescent stops | slow drift (§1.4) |
| 8 | Mouse spotlight (`MouseSpotlight`) | mouse-tracked radial | `0.4s` follow |
| 9 | SVG `#iri-grain` foil | filter on #1, #2, #4 only | static |
| 10 | Living shader wash (v1.1+, gated) | full-bleed `z-[-1]` Canvas | `uTime`, requires brand-exception review |

**Anything not on this list is a violation.** Specifically forbidden: card backgrounds, section backgrounds, section dividers, nav elements, the nav CTA (stays `bg-text` white-on-black), data tables, icon backgrounds, tinted surfaces, hover states on non-iridescent elements. Each new usage is a brand exception requiring explicit written justification in the PR.

### 4.2 The four motion guardrails that keep it ammunition

1. **Slow or none.** Iridescent motion is either static (#1, #5, #6, #9) or *environmental-slow* (orb drift 25s, shimmer 8s, shader 75s cycle). It is **never** fast, never attention-grabbing, never on a loop the eye tracks. Fast iridescent motion reads as a screensaver and destroys the "ammunition" register.
2. **Never transition the gradient definition.** Animate `opacity`, `transform`, or `background-position` (on a `background-size: 200%` element) — never the color stops themselves (causes re-paint jank and color banding). The stops are immutable: `#feed7a / #ff8400 / #df91f7`.
3. **One iridescent moment per viewport.** The hero gets the spotlight + headline span + CTA — that is the *peak*. No section below the fold may introduce a new iridescent element. If `MouseSpotlight` and the static spotlight coexist, drop one's opacity ~30% so they read as one light source, not two.
4. **Grain is scoped to iridescent elements, period.** `filter: url(#iri-grain)` on the canvas, surfaces, or body copy = CRT noise = automatic fail. It exists only to make *iridescent* elements feel like foil.

### 4.3 The one approved iridescent animation: slow shimmer

The single living-iridescent motion (besides ambient drift) is a slow `background-position` shimmer on the headline span and/or primary CTA — slow enough to feel alive, not distracting. This is the one place `linear` timing is correct (constant-velocity shimmer):

```css
.text-iridescent--shimmer {
  background-size: 200% 100%;
  animation: iri-shift 8s linear infinite;
}
@keyframes iri-shift {
  0%   { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
}
/* Primary CTA shimmer travels only on hover (confirms interactivity): */
[data-cta="primary"] {
  background-size: 200% 100%; background-position: 0% 50%;
  transition: background-position 0.5s var(--ease-default), opacity var(--dur-button);
}
[data-cta="primary"]:hover { background-position: 100% 50%; }

@media (prefers-reduced-motion: reduce) {
  .text-iridescent--shimmer { animation: none; background-position: 0% 50%; }
  [data-cta="primary"] { transition: opacity var(--dur-button); }
}
```

This is opt-in (`--shimmer` modifier) — the base `.text-iridescent` stays static. Apply shimmer to the **one** hero headline concept word, not every iridescent element; even approved motion is rationed.

---

## 5 · Build order (what ships when)

1. **Now, zero risk:** add the token ladder (§0); add the hero spotlight pseudo-element (§1.3); migrate the `globals.css` `200ms` / header `duration-500` transitions to the duration tokens (§2.2); drop in `RevealObserver` + `.reveal` classes on every marketing section (§3.1).
2. **Now, low risk:** SVG `#iri-grain` scoped to the headline span + primary CTA (§1.5); two bokeh orbs at the hero seam (§1.4); the slow headline/CTA shimmer (§4.3); `active:scale` press states on both CTA pills (§2.3).
3. **Next:** Lenis `ReactLenis root` smooth scroll (§3.2 simple form); count-up on marketing stat strips (§2.3).
4. **v1.1+ / when the paused redesign resumes, gated by brand review:** the R3F living shader wash (§1.6); GSAP ScrollTrigger wordmark parallax (§3.2 manual-loop form). Both require explicit "ammunition, not decoration" sign-off before merge.

---

## Verification checklist (every PR touching motion/ambient)

- [ ] No transition uses a raw `ms` value outside the §0 duration ladder.
- [ ] No `ease`, `ease-in-out`, or `linear` (except the §4.3 shimmer).
- [ ] No spring physics (`stiffness`/`damping`/`mass`).
- [ ] Reveal-on-scroll uses IntersectionObserver + CSS, not framer-motion.
- [ ] Iridescent appears only on the §4.1 allow-list; grain only on iridescent elements.
- [ ] Every new animation degrades correctly under `prefers-reduced-motion: reduce`.
- [ ] Ambient is GPU-composited; no canvas-wide grain, no scanlines, no glow halos on text, no phosphor green.
- [ ] All Lenis/GSAP/framer/R3F code lives behind `'use client'`; observed sections stay RSC.
- [ ] Shader path (if present) uses `flat`, `dpr={[1,1.5]}`, `clock.elapsedTime`, and is skipped (not paused) under reduced-motion.
