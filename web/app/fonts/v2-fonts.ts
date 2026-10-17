import localFont from "next/font/local";

// V2 landing typography (DESIGN.md §2 / §8). Scoped to the marketing landing
// only via the `--font-sans-v2` / `--font-mono-v2` CSS variables — the
// product app keeps Geist + Geist Mono (see app/layout.tsx). woff2 files
// were extracted from the approved artifact's embedded @font-face base64
// payloads (scripts/tmp extraction, 2026-07-02); do not re-fetch from Fontshare.

export const switzerV2 = localFont({
  src: [
    { path: "./switzer-400.woff2", weight: "400", style: "normal" },
    { path: "./switzer-500.woff2", weight: "500", style: "normal" },
    { path: "./switzer-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-sans-v2",
  display: "swap",
});

export const geistMonoV2 = localFont({
  src: [{ path: "./geist-mono-var.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-mono-v2",
  display: "swap",
});
