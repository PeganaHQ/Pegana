/**
 * The canvas colour as a literal, for the three places that cannot read CSS.
 *
 * `--color-canvas` in `app/globals.css` is the source of truth for everything
 * rendered by the browser. But the web app manifest is parsed by the OS before
 * any stylesheet exists, and `export const viewport.themeColor` is serialised
 * into a `<meta>` at build time, so neither can resolve `var(--color-canvas)`.
 *
 * Three independent transcriptions of the same hex is how the PWA splash
 * screen and the mobile browser chrome quietly stop matching the app the first
 * time the canvas is repainted. One transcription is unavoidable; three is a
 * choice. This is the one.
 *
 * ⚠️ If you change this, change `--color-canvas` in `app/globals.css` in the
 * same commit. `tests/unit/app/pwa.test.ts` asserts they agree.
 */
export const BRAND_CANVAS = "#0a0a0b";
