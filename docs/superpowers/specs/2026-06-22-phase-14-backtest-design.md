# Phase 14 — 2025-10-10 USDe Cascade Backtest (design)

**Date**: 2026-06-22
**Status**: Approved (brainstorming) → ready for implementation plan
**Supersedes/implements**: `docs/pegana-trust-layer-v0.1.0/plans/14-phase-14-15-post-launch.md` § Phase 14
**Methodology**: stays `0.4.0`; receipts emitted at schema `v2` → verifiable by the released public CLI `pegana-replay` v0.4.1.

---

## 1. Goal & thesis

Replay the **2025-10-10 market-wide liquidation cascade** (the largest crypto liquidation event to date, ~$19B) through the **current, unmodified** Pegana methodology, using **real historical Pyth data**, and produce an artifact where **every emitted alert is independently re-derivable** by anyone with the public CLI — exactly like a live alert.

This validates two things at once:
- **Detection** — the methodology fires correctly on a real depeg (USDe −4.67%, PYUSD −1.38%).
- **No false positives** — stables that held (USDC/USDT) stay PEGGED throughout.

It pairs with live monitoring: "USDe is monitored live today (`/audit?asset=USDe`); here is how the same methodology classified the worst day in recent memory, re-derivable byte-for-byte."

### Non-goals
- No changes to the production engine hot path (zero blast radius; the live system was just stabilized).
- No new methodology math — the backtest **reuses** the `methodology` crate verbatim.
- Not a profit/PnL simulation — this is a peg-classification replay only.
- Phase 15 (pricing tiers) is explicitly out of scope.

---

## 2. Asset scope & fidelity tiers

Ten assets, all with **confirmed** real historical data in Pyth Benchmarks for the window. Grouped by how faithfully the backtest reproduces the **live** data path (this honesty hierarchy is documented per-asset in the README):

| Tier | Assets | Intrinsic (live → backtest) | Market (live → backtest) | Claim strength |
|---|---|---|---|---|
| 🥇 **Perfect replica** | USDC, USDT, **sUSDe** | `fixed_1_usd` / `pyth_redemption_rate SUSDE/USDE.RR` → **identical** | `pyth_spot` → **identical Pyth feed** | Rigorous |
| 🥈 **Market-proxied** | USDe, PYUSD, USDS | `fixed_1_usd` → identical ($1) | `jupiter_usd` (executable) → **Pyth spot proxy** | Conservative lower bound¹ |
| 🥉 **Doubly-proxied** | jitoSOL, mSOL, bSOL, INF | `sanctum_lst` on-chain NAV → **Pyth `<LST>/SOL.RR` proxy** | `jupiter_usd` SOL-denom → **Pyth-derived proxy** | Directional / illustrative |

¹ During a crash, executable Jupiter price is typically **worse** (more slippage) than the Pyth oracle mid. Using Pyth spot therefore **under**states the discount → if the methodology fires on the mid, it would have fired at least as hard live. Documented explicitly.

**Confirmed depeg magnitudes (candle lows, hourly):** USDe 0.95332 (−467 bps), PYUSD 0.98619 (−138 bps), USDS 0.99709 (−29 bps), USDC 0.99931 (−7 bps), USDT 1.00002 (held). LSTs reconstructed from `<LST>/USD` ÷ `SOL/USD` vs `<LST>/SOL.RR` NAV during the SOL drop to ~$170.

**Excluded (documented reason: no reconstructable historical data):** JupSOL, bbSOL, vSOL, dzSOL, hyloSOL, hyloSOL+, xSOL, hyUSD, sHYUSD, JupUSD, sUSD, syrupUSDC, ONyc, EURC, JLP, USDY.

---

## 3. Data acquisition (Task 14.1)

**Capture once → commit a deterministic fixture.** CI never hits the network.

- **Source (price)**: Pyth Benchmarks TradingView shim — `GET https://benchmarks.pyth.network/v1/shims/tradingview/history?symbol=Crypto.<SYM>&resolution=<r>&from=<ts>&to=<ts>`. Returns OHLCV (`{s,t,o,h,l,c,v}`). **Backtest uses the candle `close`** as the tick price (standard mid; using `low` would show a deeper depeg — close is the conservative choice).
- **Window**: `2025-10-09T00:00:00Z → 2025-10-12T00:00:00Z` (full data range; gives the EWMA ample warm-up before the 2025-10-10 ~21:00Z low).
- **Resolution**: **1-minute** (4321 pts/asset; confirmed available). Captures intra-hour depeg path and realistic time-to-alert against the 30s/120s timers. If the committed fixture is too large (>~10 MB), fall back to 1-min on the active window `2025-10-09T18:00Z → 2025-10-11T06:00Z` + hourly on the tails (documented).
- **Feeds per asset**:
  - Stables (USDe/PYUSD/USDC/USDT/USDS): market = `<SYM>/USD`; intrinsic = constant `1.0`.
  - sUSDe: market = `SUSDE/USD`; intrinsic = `SUSDE/USDE.RR` (redemption rate).
  - LSTs: market_usd = `<LST>/USD`; NAV (intrinsic_sol) = `<LST>/SOL.RR`; numeraire = `SOL/USD`. SOL-denominated discount = `market_sol / intrinsic_sol − 1` where `market_sol = (<LST>/USD) ÷ (SOL/USD)`.
- **Confidence (optional, display-only)**: `rederive()` **excludes** `confidence_label` from verification (engine resolves it against `Utc::now()`), so confidence is **not required** for re-derivability. Where a confidence label is wanted for the README/web display, sample the exact Pyth `conf` from Hermes (`GET https://hermes.pyth.network/v2/updates/price/<ts>?ids[]=<feed_id>&parsed=true`) at transition timestamps only (a handful per asset), not at every tick.
- **Cross-check (README only)**: spot-check the depeg trough against CoinGecko + DefiLlama; document tolerance. Not a code dependency.

**Fixture format** (`docs/backtests/2025-10-10-usde-depeg/inputs.json`):
```json
{
  "schema_version": "v1",
  "captured_at": "2026-06-22T..Z",
  "source": "pyth-benchmarks tradingview shim, resolution=1",
  "window": { "start": "2025-10-09T00:00:00Z", "end": "2025-10-12T00:00:00Z" },
  "series": {
    "USDe":   { "market_feed": "USDE/USD",  "intrinsic": "fixed_1_usd", "ticks": [ { "t": 1759968000, "market_usd": "..." } ] },
    "sUSDe":  { "market_feed": "SUSDE/USD", "intrinsic_feed": "SUSDE/USDE.RR", "ticks": [ { "t": ..., "market_usd": "...", "intrinsic_usd": "..." } ] },
    "jitoSOL":{ "market_feed": "JITOSOL/USD", "nav_feed": "JITOSOL/SOL.RR", "numeraire_feed": "SOL/USD",
                "ticks": [ { "t": ..., "market_usd": "...", "market_sol": "...", "intrinsic_sol": "..." } ] }
  }
}
```

---

## 4. Architecture — runner mirrors the engine tick-loop (Task 14.2)

**Approach A (chosen):** the runner replicates the engine's per-tick orchestration by calling the **pure** `methodology` functions and threading state forward exactly like `AssetRuntime` — no methodology duplication, no engine changes. `rederive()` is used to **self-verify** each emitted receipt (the same check the public CLI runs).

**Per asset, per tick (1-min), in the exact engine order** (mirrors `rederive.rs` module docs / `engine-rs` `try_recompute`):

```
state init:  ewma_prev = None ; previous_state = Pegged ; candidate_state = None ; candidate_since = None

for each tick t (ascending):
  discount_raw   = compute_discount(intrinsic_usd, market_usd, intrinsic_sol, market_sol, class)   // skip tick if None
  if !is_plausible_discount_sample(discount_raw): continue                                          // |d| < 1.0 guard
  discount_smooth = apply_ewma_pure(discount_raw, ewma_prev, alpha=0.3)
  candidate       = classify_with_hysteresis(class, discount_smooth, thresholds_bps, previous_state, DEADBAND_PCT=25)
  decision        = transition_decide(previous_state, candidate, candidate_state, candidate_since, now=t,
                                      confirm_up_secs=30, decay_down_secs=120)
  final_state     = decision.new_last_state
  if premium_sanity_violated(class, discount_smooth): final_state = Unknown                          // belt-and-suspenders

  // emit timeline row always; emit a transition record + receipt when final_state changes
  inputs = InputsFrozen { asset, class, now=t, alpha, intrinsic_usd, market_usd, intrinsic_sol, market_sol,
                          ewma_prev, hyusd_cr=None, previous_state, candidate_state, candidate_since,
                          thresholds, threshold_kind="bps", pyth_entries, confirm_up_secs=30, decay_down_secs=120 }
  receipt_sha = canonical_receipt_hash(&Receipt{ schema_version:"v2", methodology_version:"0.4.0", ..., inputs, computed })
  assert rederive(&inputs) == { discount_raw, discount_smooth, final_state }   // self-verify every receipt

  // thread forward (exactly AssetRuntime's write-back)
  ewma_prev       = discount_smooth
  previous_state  = final_state
  candidate_state = decision.new_candidate_state
  candidate_since = decision.new_candidate_since
```

No CR assets in scope (hyUSD excluded) → only the BPS path is exercised; `threshold_kind` is always `"bps"`.

**Location**: `crates/xtask/src/` — add a `backtest` subcommand: `xtask backtest --case 2025-10-10-usde-depeg`. Loads `inputs.json` + `assets-snapshot.toml`, runs the loop, writes `methodology-output.json`. Thin driver script `scripts/run-backtest.sh` wraps it.

**`assets-snapshot.toml`**: a frozen copy of the 10 assets' current config blocks (class, peg_target, intrinsic/market kind, `thresholds_bps`) — "current methodology applied retroactively". `assets_toml_canonical` in each receipt is `canonical_assets_hash(<this snapshot>)`.

---

## 5. Output & verifiability (Task 14.2)

**`docs/backtests/2025-10-10-usde-depeg/methodology-output.json`** (golden file):
```json
{
  "case": "2025-10-10-usde-depeg",
  "methodology_version": "0.4.0",
  "generated_from": "inputs.json sha256 ...",
  "assets": {
    "USDe": {
      "fidelity": "market-proxied",
      "transitions": [
        { "t": "...", "from": "PEGGED", "to": "DRIFT", "discount_smooth": "...", "receipt_sha256": "..." },
        { "t": "...", "from": "DRIFT",  "to": "DEPEG", "discount_smooth": "...", "receipt_sha256": "..." }
      ],
      "time_to_first_alert_secs": 0,
      "max_state": "CRITICAL",
      "timeline_summary": { "ticks": 4321, "pegged": n, "drift": n, "depeg": n, "critical": n }
    }
  }
}
```
- Each transition carries an `expected_receipt_sha256` (schema **v2**, methodology **0.4.0**) → **verifiable by the public `pegana-replay` v0.4.1** offline. The full per-transition `InputsFrozen`+`Receipt` bundles are written to `docs/backtests/2025-10-10-usde-depeg/receipts/<asset>-<seq>.json` so a reader can run `pegana-replay --bundle <file>`.
- Full per-tick timeline (for the chart) goes to `timeline/<asset>.csv` (kept out of the golden diff if it bloats; the golden gate runs on the deterministic `methodology-output.json` transitions).

---

## 6. Web page (Task 14.3 — web)

Route `web/app/backtest/2025-10-10-usde-depeg/page.tsx` (and an index `web/app/backtest/page.tsx`). **Reuses existing components only** (Recharts, `BandGauge`, the pure-JS in-browser verify from the T2 trust-UX work) to keep scope bounded.

- Hero: the narrative (what happened on 2025-10-10) + headline stat (time-to-first-alert, max state per asset).
- Cascade chart: discount-over-time per asset with state-band shading; transition markers.
- Per-asset rows with the **fidelity badge** (perfect / market-proxied / doubly-proxied) and the depeg magnitude.
- "Verify this receipt" affordance per transition → in-browser byte-exact re-derivation (no CLI/billing needed), mirroring the existing /audit verify.
- Pairs with live: prominent link to `/audit?asset=USDe`.
- Disclaimer banner: "Hypothetical backtest against real historical Pyth data. No live alert was emitted on this date. Methodology v0.4.0, unmodified."

Static generation (data is a committed JSON) — no new API surface.

---

## 7. CI gate

`.github/workflows/backtest.yml` — on every PR:
1. `cargo run -p xtask -- backtest --case 2025-10-10-usde-depeg --check`
2. Re-runs the backtest from the committed `inputs.json` and **fails on any drift** vs the committed `methodology-output.json` (transitions + receipt hashes must match byte-for-byte).

This turns the backtest into a **methodology regression guard**: any future change to `methodology` that would alter historical classification is caught in PR.

---

## 8. Testing strategy (the "100%" bar)

- **Round-trip (core invariant)**: every emitted receipt passes `rederive(&inputs) == computed` — asserted inside the runner AND in a dedicated test. This is the same check the public CLI performs.
- **Determinism / golden**: same `inputs.json` → byte-identical `methodology-output.json` (run twice in test).
- **Directional sanity** (range assertions, not exact, so EWMA smoothing can't make them brittle):
  - USDe reaches **≥ DEPEG** (expected CRITICAL given −467 bps vs critical 300).
  - PYUSD reaches **≥ DRIFT** (expected DEPEG given −138 bps vs depeg 50 / critical 200).
  - USDC and USDT remain **PEGGED for the entire window** (no false positive).
  - At least one LST registers a transition during the SOL drop (cascade evidence).
- **Threading parity**: a focused unit test feeds a short synthetic series through the runner and through an inline reference that calls the pure functions in the documented order, asserting identical state threading (guards against the runner diverging from `AssetRuntime`'s write-back order).
- **Public-CLI acceptance**: pick one real emitted bundle, run the actual `pegana-replay --bundle` against it, assert PASS (proves the artifact is verifiable by the shipped tool, not just internally).
- Full workspace: `cargo test`, `cargo fmt --check`, `cargo clippy`; web `pnpm build` + `vitest`.

---

## 9. File layout

```
docs/backtests/2025-10-10-usde-depeg/
  inputs.json                 # committed Pyth fixture (Task 14.1)
  assets-snapshot.toml        # frozen 10-asset config
  methodology-output.json     # golden transitions + receipt hashes (Task 14.2)
  receipts/<asset>-<seq>.json # per-transition verifiable bundles
  timeline/<asset>.csv        # per-tick series for the chart
  README.md                   # narrative + sources + fidelity table + disclaimer (Task 14.3)
crates/xtask/src/             # `backtest` subcommand (capture + run + --check)
scripts/run-backtest.sh       # thin wrapper
.github/workflows/backtest.yml
web/app/backtest/page.tsx                          # index
web/app/backtest/2025-10-10-usde-depeg/page.tsx    # the case (reuses existing components)
```

---

## 10. Constants reference (must match production exactly)

| Constant | Value | Source |
|---|---|---|
| EWMA `alpha` | `0.3` | engine env default |
| `CONFIRM_UP_SECS` | `30` | engine-rs |
| `DECAY_DOWN_SECS` | `120` | engine-rs |
| `DEADBAND_PCT` | `25` | methodology |
| Receipt schema | `v2` | engine emits v2; `rederive` requires v2 |
| methodology_version | `0.4.0` | `methodology/src/version.rs` |
| cold-start `previous_state` | `PEGGED` | GAP-3 semantics (`g.last_state`) |

**Per-asset `thresholds_bps` (drift / depeg / critical), from `assets.toml`:** USDC 15/50/200 · USDT 15/50/200 · PYUSD 15/50/200 · USDe 25/100/300 · USDS 20/75/250 · sUSDe 30/100/300 · jitoSOL 45/110/250 · mSOL 40/100/250 · bSOL 45/110/250 · INF 140/280/560.

---

## 11. Risks & open items

- **Fixture size** at 1-min × 10 assets — mitigated by the tail-downsampling fallback (§3) and keeping the per-tick `timeline/` out of the golden diff.
- **LST fidelity** is the weakest (doubly-proxied) — mitigated by the explicit per-asset fidelity badge and README disclosure; LSTs carry "directional" claims only.
- **Benchmarks symbol/feed-id drift** — capture is one-time and committed; CI uses the fixture, so an upstream Pyth change cannot break CI.
- **EWMA may smooth the peak below the instantaneous low** — handled by range-based sanity assertions (§8), not exact-state expectations.

---

## 12. Implementation note

Implementation will be delegated to **Codex** (`codex` CLI) step-by-step from the plan; **Opus reviews every diff**, runs the full test suite, and the change is finalized with `/code-review`. Each plan step is sized to be independently testable.
