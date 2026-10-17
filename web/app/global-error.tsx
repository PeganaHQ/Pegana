"use client";

import { useEffect } from "react";
import { WAVE_PATH } from "@/lib/brand/wave";

// Fires only when the ROOT layout itself has crashed, so this can't depend on
// anything the root layout provides — no next/font (per DESIGN.md/W1
// instructions), no Tailwind classes (globals.css may not have loaded), no
// v2.css import, no shared V2 organisms. Everything here is plain inline
// styles plus one self-contained <style> block for the handful of things
// inline styles can't express (keyframes, prefers-reduced-motion, a mobile
// breakpoint) — same reasoning as the pre-existing version of this file, now
// carrying the V5 visual language (drift-line motif, critical state pill,
// eyebrow/h1/sub/ctas) instead of the old bracket-style fault banner.

const MONO =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const GRADIENT_STOPS = (
  <>
    <stop offset="0" stopColor="#ff8a1e" />
    <stop offset="0.26" stopColor="#fd662c" />
    <stop offset="0.5" stopColor="#f7269b" />
    <stop offset="0.75" stopColor="#c02ef2" />
    <stop offset="1" stopColor="#9b34fa" />
  </>
);

// Default (no-JS/reduced-motion) state is the animation's END state — the
// line fully drawn, everything visible — same contract as
// components/organisms/v2/error-surface-v2.tsx. Only under
// `prefers-reduced-motion: no-preference` do we flip to the hidden start
// state and animate in.
const STYLE = `
.gerr-drift { stroke-dasharray: 520; stroke-dashoffset: 0; }
.gerr-rise { opacity: 1; }
@media (prefers-reduced-motion: no-preference) {
  .gerr-drift { stroke-dashoffset: 520; animation: gerr-draw .95s cubic-bezier(.22,1,.36,1) .15s forwards; }
  .gerr-rise { opacity: 0; translate: 0 10px; animation: gerr-rise .6s cubic-bezier(.22,1,.36,1) forwards; }
  .gerr-rise-1 { animation-delay: .2s; }
  .gerr-rise-2 { animation-delay: .28s; }
  .gerr-rise-3 { animation-delay: .36s; }
  .gerr-rise-4 { animation-delay: .44s; }
}
@keyframes gerr-draw { to { stroke-dashoffset: 0; } }
@keyframes gerr-rise { to { opacity: 1; translate: 0 0; } }
@media (max-width: 520px) {
  .gerr-ctas { flex-direction: column; align-items: stretch; width: 100%; }
  .gerr-ctas a, .gerr-ctas button { justify-content: center; min-height: 46px; }
}
`;

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    console.error("[pegana] fatal error", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          background: "#0a0a0b",
          color: "#f5f5f6",
          fontFamily: SANS,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          textAlign: "center",
        }}
      >
        <style dangerouslySetInnerHTML={{ __html: STYLE }} />

        <div style={{ position: "relative", marginBottom: "2.25rem" }}>
          <svg
            viewBox="0 0 420 128"
            width={260}
            height={79}
            fill="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="pgFatalDrift" x1="0" y1="0" x2="1" y2="0">
                {GRADIENT_STOPS}
              </linearGradient>
            </defs>
            <line
              x1="6"
              y1="34"
              x2="414"
              y2="34"
              stroke="rgba(255,255,255,.14)"
              strokeWidth="1"
              strokeDasharray="1 6"
              strokeLinecap="round"
            />
            <path
              className="gerr-drift"
              d="M 6 34 L 150 34 C 236 34, 258 96, 368 96"
              stroke="url(#pgFatalDrift)"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
            <circle cx="368" cy="96" r="3.5" fill="#e0574e" />
            <circle
              cx="368"
              cy="96"
              r="8"
              stroke="#e0574e"
              strokeOpacity=".35"
              strokeWidth="1"
            />
          </svg>
          <span
            style={{
              position: "absolute",
              right: "-8px",
              bottom: "-12px",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              border: "1px solid rgba(224,87,78,.38)",
              borderRadius: "999px",
              padding: "4px 10px",
              fontFamily: MONO,
              fontSize: "10px",
              color: "#e0574e",
              background: "rgba(10,10,11,.72)",
            }}
          >
            <i
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: 99,
                background: "#e0574e",
              }}
            />
            Critical
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginBottom: "1.75rem",
          }}
        >
          <svg
            width="26"
            height="26"
            viewBox="279 313 699 633"
            fill="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="pgFatalWave" x1="0" y1="0" x2="1" y2="0">
                {GRADIENT_STOPS}
              </linearGradient>
            </defs>
            <path fillRule="evenodd" d={WAVE_PATH} fill="url(#pgFatalWave)" />
          </svg>
          <span
            style={{
              fontFamily: SANS,
              fontWeight: 600,
              fontSize: "0.95rem",
              letterSpacing: "-0.02em",
              color: "#f5f5f6",
            }}
          >
            egana
          </span>
        </div>

        <span
          className="gerr-rise gerr-rise-1"
          style={{
            display: "inline-flex",
            border: "1px solid rgba(255,255,255,.08)",
            borderRadius: "999px",
            padding: "5px 12px",
            fontFamily: MONO,
            fontSize: "10px",
            fontWeight: 500,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "#70707a",
            marginBottom: "1.6rem",
          }}
        >
          Unexpected error
        </span>

        <h1
          className="gerr-rise gerr-rise-2"
          style={{
            margin: "0 0 0.9rem",
            maxWidth: "17ch",
            fontFamily: SANS,
            fontSize: "clamp(26px, 5vw, 36px)",
            fontWeight: 600,
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
          }}
        >
          The web client failed to mount.
        </h1>

        <p
          className="gerr-rise gerr-rise-3"
          style={{
            margin: "0 0 2.25rem",
            maxWidth: "42ch",
            fontFamily: SANS,
            fontSize: "0.95rem",
            lineHeight: 1.65,
            color: "#a3a3ad",
          }}
        >
          The crash was recorded on our side. The oracle data feed stays
          reachable directly at api.pegana.xyz.
        </p>

        <div
          className="gerr-ctas gerr-rise gerr-rise-4"
          style={{
            display: "flex",
            gap: "0.75rem",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              borderRadius: "999px",
              padding: "0.75rem 1.5rem",
              background: "#fff",
              color: "#141118",
              border: "none",
              cursor: "pointer",
              fontFamily: MONO,
              fontSize: "12px",
              fontWeight: 500,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
            }}
          >
            Reload
          </button>
          <a
            href="https://api.pegana.xyz"
            rel="noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              borderRadius: "999px",
              padding: "0.7rem 1.4rem",
              background: "rgba(255,255,255,.02)",
              color: "#f5f5f6",
              border: "1px solid rgba(255,255,255,.16)",
              textDecoration: "none",
              fontFamily: MONO,
              fontSize: "12px",
              letterSpacing: "0.09em",
              textTransform: "uppercase",
            }}
          >
            api.pegana.xyz
          </a>
        </div>
      </body>
    </html>
  );
}
