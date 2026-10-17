// Ambient app-shell background: a static, brand-tinted glow wash carrying the
// same coral -> magenta -> lavender spectrum the marketing hero uses, so every
// signed-in page shares the landing's premium atmosphere — the "soft light
// above the instrument panel" cue (the calm-SaaS vocabulary Pegana's research
// measured on Linear/Vercel). This is now the ONLY background layer the app
// experience renders: the root layout no longer mounts the global <Background/>
// (DotGrid + MouseSpotlight) — it was already fully occluded on marketing
// routes by .pegana-v2's opaque canvas, and on app routes it just double-
// stacked under this glow. The DotGrid/MouseSpotlight/Background component
// files have since been removed — they were dead once this became the sole
// background layer.
//
// Three layered radial glows: coral warmth peaking off-screen top-center
// (strongest where there's no data — behind the topbar), plus a faint lavender
// bloom lower-left and a whisper of magenta lower-right to close the spectrum
// in the corners. Deliberately NOT a texture (no repeating pattern behind live
// data — that's what got the dotted grid killed) and every alpha stays low and
// corner/edge-weighted so it can never wash the center-page tables, numbers, or
// cards: the strongest stop is 0.055 and it has faded past ~40% viewport height
// before any table row begins. Pure CSS, one paint, no JS, no motion — nothing
// to gate under prefers-reduced-motion.
export function AmbientGlowBg() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0"
      style={{
        background: [
          "radial-gradient(115% 52% at 50% -10%, rgba(255,138,91,0.055), rgba(251,111,174,0.022) 34%, transparent 60%)",
          "radial-gradient(78% 55% at 10% 106%, rgba(223,145,247,0.04), transparent 58%)",
          "radial-gradient(66% 48% at 100% 100%, rgba(251,111,174,0.026), transparent 55%)",
        ].join(", "),
      }}
    />
  );
}
