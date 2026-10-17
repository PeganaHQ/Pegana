# Pegana — Relaunch changelog (2026-07-18)

> ## ⚠️ HISTORICAL — do not post as-is
>
> Written 2026-07-18, **before** the V1 production deploy on 2026-07-23. It is missing
> everything from 07-23 onward: the deploy itself, the systemic-impact simulator, the `/v1`
> contract reshape, the live WebSocket feed, the SDKs, and the verifier's `--json` release.
> Superseded by the V1 launch material (`docs/strategy/2026-07-30-pegana-v1-launch.md`).
>
> Marketing-facing. Companion to the "What's New" page and `docs/CHANGELOG-V2.md`
> (the engineering log). Every claim below reflected validated, shipped reality **as of
> 2026-07-18** — no vaporware, but check the numbers against production before reusing them.

## The headline

**The peg-risk oracle, now proven on-chain.** Every severe verdict Pegana
publishes is anchored on Solana mainnet and re-derivable byte-for-byte by anyone —
it's not a claim, it's a transaction (a real Depeg receipt landed 2026-07-05,
slot 430,927,168).

## Trust & methodology (v0.7.0)

- **A real >30% collapse now reads BLACK_SWAN** — a NAV-sanity guard used to mask
  genuine catastrophic depegs as UNKNOWN indefinitely. The worst minute of an
  asset's life is exactly when the oracle has to be right; now it is.
- **Confirmed verdicts survive noisy oracles** — Pyth confidence widens during the
  same volatility a crash produces, so a confirmed verdict no longer gets erased by
  the market stress that proves it real.
- **One verdict, three ways to check it** — the live engine, the offline replay
  CLI, and the backtest share a single verdict function; they agree by construction
  and can't drift apart.
- **Honest-dark on stale data** — new Pyth-confidence and intrinsic-liveness gates
  plus a numéraire-staleness check mean a frozen feed reads UNKNOWN, never a
  confident, wrong PEGGED.

## Security

- **Webhook DNS-rebinding closed** — outbound deliveries pin to the exact validated
  IP, so a rebinding DNS can't swing a POST to an internal host between check and
  connect. Signed (Ed25519), redirect-locked, and crash-recoverable end to end.
- **No alert silently lost** — the dispatcher shuts down gracefully and recovers
  any in-flight alert stranded by a crash.

## The app, rebuilt (front & back)

- **A frozen feed can't fake a peg** — freshness gates across the dashboard,
  command palette, and embed badges collapse a stale reading to UNKNOWN everywhere.
- **Bands track the live calibration** — the whole UI reads the authoritative
  per-asset thresholds the API serves; recalibrate once, the UI follows.
- **Onboarding on mobile** — the walkthrough opens on phones, with a persistent way
  back to it.
- **Built for a desk** — portfolio CSV export, a real 52-week event heatmap,
  cross-device watchlists, honest "heuristic, not a live verdict" labeling, and a
  self-serve "request coverage" path for issuers.
- **Integrator-ready** — `confidence` on the state endpoint, the full webhook
  payload documented (incl. the beta-calibration flag), lossless event-stream
  cursors.

## Verify it yourself

```
cargo install pegana-replay
```

Re-derive any receipt hash-for-hash and check its on-chain anchor from your own
machine. 100% open methodology.

---
🦅 Pegana · the Solana Trust Layer · pegana.xyz
