# Webhook Threshold Picker — semantic + custom

**Date:** 2026-06-09
**Status:** Implemented (frontend-only) — vitest + Playwright green locally, not deployed
**Branch:** `feat/webhook-threshold-picker`

## Problem

The webhook create form's threshold control is a raw `Threshold bps` number input
(default 100). It's bad UX:
- **bps is jargon** (100 bps = 1%); lead with %.
- **A flat 100 is wrong per asset** — the right value is entirely asset-dependent and the
  frontend already knows it (`lib/alerts/policy.ts::thresholdsFor` → drift/depeg/critical bps):
  USDC depegs at 50 bps, sUSD trades ~275 bps off NAV by design, xSOL swings in thousands.
- **No context** — user can't see the asset's normal range or where it sits now.
- **Exposes the mechanism, not intent** — users think "tell me when it depegs," not "≥100 bps."

## Goal

Replace the bps box with an **Alert level** control: semantic presets (auto-calibrated per
asset) **plus** a custom value for personalization. Frontend-only — still sends `threshold_bps`
to the unchanged API. No backend, no migration, no calibration risk.

## Design

### Control

```
Alert level          jitoSOL · now 12 bps · PEGGED
─────────────────────────────────────────────────
[  Drift  ] [ Depeg ✓ ] [ Critical ] [ Custom ]
  0.45%        1.10%        2.50%      [__]%
 leaves band  real depeg   severe only
─────────────────────────────────────────────────
→ You'll be alerted when jitoSOL drifts past 1.10%
```

- **3 semantic presets** = the asset's `drift_bps / depeg_bps / critical_bps`
  (`thresholdsFor(symbol, class)`), each showing **% (primary) + bps (caption) + meaning**.
- **Default = Depeg** (fewest, most meaningful alerts for a webhook/Discord consumer).
- **Custom** reveals a `%` input (bps shown), converted to bps and **clamped 1..10000**.
- **Context line**: asset's live discount magnitude + state (`AssetCardData.discount`/`state`);
  `—` when discount is null. Plain-language confirmation of what fires.
- Switching assets re-tunes preset values live; the Custom value persists.

### Units / edge rules

- `%` is the display unit; the API field stays `threshold_bps` (integer).
- `bps = clamp(round(pct * 100), 1, 10000)`; `pct = bps / 100`.
- Asset with no per-symbol band → class fallback (already in `thresholdsFor`).
- No re-render loop: resolved bps is derived; parent `onChange(bps)` is a no-op when unchanged
  (React bails on identical primitive state).

### Components (frontend)

- **New** `lib/webhooks/threshold.ts` — pure logic: `bpsForLevel`, `resolveBps`, `bpsFromPct`,
  `pctLabel`. The testable core.
- **New** `components/molecules/threshold-picker.tsx` — the control. Props: `symbol`,
  `assetClass`, `currentDiscountBps | null`, `currentState | null`, `value` (bps), `onChange(bps)`,
  `disabled`. Owns `level` + `customBps` UI state; emits resolved bps.
- **Modify** `components/molecules/webhook-create-form.tsx` — restructure grid so URL + Asset +
  Register sit on row 1 and the Alert level gets a full-width row; pass the selected asset's
  class + current discount into the picker.
- **Modify** `components/organisms/webhook-list.tsx` — show threshold as `≥ 1.10%` (bps on hover)
  instead of raw bps.

### Testing

- **vitest** (`tests/unit/webhooks/threshold.test.ts`): `bpsForLevel` per asset (jitoSOL/USDC/
  fallback), `resolveBps` clamps + custom, `bpsFromPct`/`pctLabel` round-trips and formatting.
- **Playwright** (extend `tests/e2e/webhooks.spec.ts`): picking Depeg sets the right value, asset
  switch re-tunes, Custom reveals the input and a custom % flows through to the create POST body,
  axe gate still green.

## Implementation notes (as built)

- `lib/webhooks/threshold.ts`: `bpsForLevel`, `resolveBps`, `bpsFromPct`, `pctFromBps`,
  `clampBps`, `pctLabel` + `PRESET_LEVELS` / `DEFAULT_LEVEL` / `LEVEL_MEANING`. 15 vitest.
- `components/molecules/threshold-picker.tsx`: `<fieldset>`/`<legend>` radiogroup with
  `sr-only` radios + styled cards; `has-[:focus-visible]` outline so keyboard focus stays
  visible (axe doesn't catch focus-visibility, but the repo keeps focus rings). 6 vitest.
- Form: added `aria-label="Asset"` to the asset `<select>` (was an ugly
  "AssetjitoSOLUSDC" a11y name; also disambiguates from the app-shell "Search assets"
  button in tests). Picker's `value` prop is optional (seeds level/custom for a future
  "edit hook" use); the create form omits it → defaults to the asset's Depeg band.
- Defensive: a lean `/v1/assets` payload (no `class`/`discount`) → class falls back to
  `stable_fiat` and drift shows `—`; `thresholdsFor` keys off the symbol first, so every
  real catalog asset still calibrates correctly.
- e2e: 4 new cases (default Depeg → band, asset-switch re-tune, Custom % → bps, list shows
  `%`) + the axe gate stays green. 9/9 Playwright, 215/215 vitest.

## Non-goals

Backend personalization (multi-asset per hook, quiet hours, state/direction filters, custom
templates) — separate roadmap. The semantic presets already deliver per-asset + severity tuning.
