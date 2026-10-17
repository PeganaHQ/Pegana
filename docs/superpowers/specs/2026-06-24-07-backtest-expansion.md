# Spec 07 — Backtest expansion (templatize + new Solana depeg replays)

**Wave 1 (code) / Wave 3 (events) · xtask + web + CI · no migration · methodology stays
0.4.0.** More replays of real Solana depegs, framed as DEMAND artifacts ("here's the alert
you'd have received, X minutes early") — never as proof-of-formula.

## Problem / context

One backtest exists (2025-10-10 USDe cascade). The pipeline is clean and event-agnostic
where it counts: **capture (network, one-time) → compute (deterministic, no network) →
publish (committed fixture + golden + receipts → web page + CI gate)**. Methodology 0.4.0
runs UNMODIFIED; the value prop is that the same `methodology` crate the live engine uses
emits receipts the public `pegana-replay` CLI re-derives byte-exact.

- Runner: `xtask` `Backtest{case,capture,check}` (`main.rs:52-63,82-87`), `scripts/run-backtest.sh` (already case-parameterized). Orchestration `backtest/mod.rs`: `run()` (`:111`), `compute_output()` (`:59`, version from `methodology::methodology_version()` — pinned by the crate, shared across cases), `run_asset()` (`runner.rs:53`, self-checks every tick via `rederive` + `ensure!` — the byte-exact guarantee, fully event-agnostic).
- Hardcoded-to-one-event spots: `capture_inputs` (`mod.rs:161-357`: `FROM/TO`, `RESOLUTION`, inline 10-asset `specs`, window); `fidelity()` symbol match (`:16-23`); the web index card; `backtest-data.ts`'s **123 individual receipt imports**; the CI `--check`/golden/CLI-acceptance case strings.
- Fixture: `docs/backtests/<case>/{inputs.json (8.4MB raw, committed), assets-snapshot.toml, methodology-output.json (golden), receipts/<SYM>-NNN.json, README.md}`.
- CI drift gate `.github/workflows/backtest.yml` (3 steps, all hardcode the case string).
- Web `backtest-chart.tsx` + `static-receipt-verifier.tsx` are already fully generic.

## Goals / non-goals

- **Goal:** templatize so "event N" is cheap, then add 1-2 real Solana depeg replays.
- **Non-goal:** any methodology change (0.4.0 stays the verifiable target — history + the released CLI must keep verifying); a sUSD backtest (proof trap, per memory); choosing an event because the methodology "looks good".

## Design — templatize (decided)

The compute + web-component layers are already event-agnostic. Fix the three hardcoded spots once:

1. **Runner config-driven capture.** Extract the `capture_inputs` literals (`mod.rs:167-169,181-272,341-343`) into a per-case **`docs/backtests/<case>/capture.toml`** (`from`,`to`,`resolution`,`window`,`[[spec]]` rows) read by `capture_inputs`. `--capture` then works for any case with zero Rust edits. Generalize `fidelity()` (`:16-23`) to derive from the per-asset spec (fixed-$1+Pyth-spot="perfect", fixed-$1+jupiter-proxy="market-proxied", NAV+numeraire="doubly-proxied") instead of a symbol match. `compute_output`/`run_asset`/`run` need NO change.
2. **Collapse the 123-import problem.** Have Rust `run()` (`mod.rs:135-152`) ALSO emit `receipts/all.json` (array of bundles). `backtest-data.ts` becomes one import (`import receipts from ".../<case>/receipts/all.json"`) instead of 123 hand-written lines. **This is the single highest-leverage change** — without it each event adds ~100 unreviewable import lines. DECIDED: emit from Rust (single source).
3. **Manifest.** `docs/backtests/manifest.json` — `[{case,title,date,methodology_version,headline_asset,max_state,receipt_count,candle_low,blurb,sources[]}]`. Web index maps it; detail-page hero copy reads it (pages stop hardcoding strings).
4. **Shared detail component.** Factor `2025-10-10-usde-depeg/page.tsx:60-280` into `web/app/backtest/_components/backtest-case.tsx({output,fixture,receipts,manifestEntry})`. Each `<case>/page.tsx` becomes a thin wrapper. `backtest-chart.tsx` + `static-receipt-verifier.tsx` reused unchanged.
5. **CI matrix.** `.github/workflows/backtest.yml:25,27,30` → `strategy.matrix.case`; parameterize `load_golden(case)` in `backtest_runner.rs:267-322`; add per-event directional tests.

## Candidate events (ranked) — DATA AVAILABILITY IS THE GATING BLOCKER

The capture path (`benchmarks.rs:49-92`) hits Pyth Benchmarks under `Crypto.<SYMBOL>`.
Historical minute candles for 2022-2023 are NOT guaranteed. **Every event requires a
`run-backtest.sh <case> capture` dry-run to confirm data before committing a fixture.**

1. **USDC depeg / SVB collapse — 2023-03-11 (STRONGEST).** USDC→~$0.88 (Circle's $3.3B at SVB), full recovery in ~48h. The canonical Solana-relevant stablecoin depeg (whole stack repriced); complements the existing event (which showed USDC *holding*). Demand-narrative gold. **Data risk MEDIUM** — feed existed; minute history that far back must be verified (else coarser resolution + disclose).
2. **FTX-era LST/SOL dislocation — 2022-11 (showcase the LST path).** SOL crash → LST/SOL redemption-vs-market gap widened then re-converged. Purely Solana-native; exercises the most differentiated `nav_feed`/`numeraire_feed` path. **Data risk HIGH** (`*/SOL.RR` + LST/USD feed history; mSOL/SOL safer than jitoSOL which launched later). Event #3, not #2.
3. **A recent isolated Solana stable wobble (2024-2025).** Lower data risk, but must be genuinely notable (else filler). Fallback "event 2".

**Recommendation:** ship USDC/SVB 2023-03-11 first (highest narrative value), then the FTX-era LST/SOL event — both gated on a capture dry-run.

## Files to touch (exact)

- Runner: `xtask/src/backtest/mod.rs` (capture.toml reader replacing `:167-169,181-272,341-343`; generalize `fidelity()` `:16-23`; `run()` also writes `receipts/all.json` `:135-152`); `xtask/src/backtest/types.rs` (+`CaptureConfig`/`SpecConfig`); `scripts/run-backtest.sh` (no change — already parameterized).
- Fixtures (per new event): NEW `docs/backtests/<case>/capture.toml` + generated `{inputs.json, assets-snapshot.toml, methodology-output.json, receipts/, README.md}`; NEW `docs/backtests/manifest.json`.
- Web: `backtest/2025-10-10-usde-depeg/backtest-data.ts` (collapse 123 imports → one `all.json`); NEW `backtest/_components/backtest-case.tsx`; `backtest/page.tsx:33-55` (map manifest); NEW `backtest/<case>/page.tsx` wrapper. Reuse unchanged: `backtest-chart.tsx`, `static-receipt-verifier.tsx`, `web/lib/verify-receipt.ts`, `layout.tsx`. Optional `web/app/sitemap.ts` (+backtest routes).
- CI: `.github/workflows/backtest.yml:25,27,30` (matrix); `xtask/tests/backtest_runner.rs:267-322` (parameterize `load_golden`, per-event directional tests).

## Risks

- **Proof-trap framing (top guardrail):** new events MUST carry the existing disclaimers (`page.tsx:263-274`, README) and be framed as demand artifacts. Report honest results (the existing USDT→DEPEG "premium is a real disagreement" note is the gold standard). Never pick an event to flatter the formula.
- **Data availability (the real blocker):** dry-run `--capture` first; if minute data absent, coarser resolution + disclose, or reconstruct from another source. `*/SOL.RR` feeds are riskiest.
- **Fixture bloat:** ~8.4MB raw per event, no LFS today; 3 events ≈ 25MB. Mitigate via narrower windows / fewer assets, or introduce Git LFS for `docs/backtests/*/inputs.json` (but LFS complicates the no-network CI checkout — verify first). OPEN.
- **Methodology must stay 0.4.0/unmodified** — version is crate-shared, so a new event auto-pins it. Do NOT bump methodology to make an event classify "better".
- **`backtest-data.ts` import explosion** without the `all.json` aggregation → treat #2 as a prerequisite, not optional.
- **CI matrix runtime** ~triples per 3 cases (rust-cache shared) — acceptable.

## Test plan + acceptance

- Determinism: `compute_output` twice → byte-identical (mirror `backtest_runner.rs:246-265`).
- Self-rederive: every bundle satisfies `rederive == expected_computed` (enforced in `run_asset:166-172`; add per-case test).
- Drift gate: `xtask backtest --case <new> --check` exits 0.
- **Public-CLI acceptance (core):** `pegana-replay-cli --bundle docs/backtests/<new>/receipts/<SYM>-001.json` prints `PASS` (mirror `backtest.yml:29-31`).
- Directional per event: `golden_*` assertions (USDC/SVB max_state ∈ {DEPEG,CRITICAL}; recovery transition back to PEGGED exists).
- Web build: `next build` with the new data module; in-browser verifier returns "Verified — hash matches".
- Acceptance: fixture+golden+receipts committed; drift gate + CLI-acceptance + golden tests green in the CI matrix; web index lists the event; detail page renders with working in-browser verify; README carries narrative + honest results + replay disclaimer.

## Decided open questions

- Templatize via capture.toml + Rust-emitted `receipts/all.json` + manifest.json + CI matrix — DECIDED.
- Events: USDC/SVB 2023-03-11 first, then FTX-era LST/SOL — DECIDED, **both gated on a `--capture` dry-run** (the one true blocker).
- Retroactive-methodology disclaimer in README (applying 0.4.0 to a 2023 event) — DECIDED: yes.
- Fixture storage (raw vs Git LFS) — OPEN (decide before fixture #2 lands).
- Asset roster per event (reuse ~10 vs tailor) — tailor via `capture.toml` per event — DECIDED.

## Grill outcomes

- *"Isn't more backtests the proof trap the memory warns about?"* — Risk acknowledged. The guardrail: choose events with genuine narrative weight (SVB/FTX are macro-historic, not cherry-picked), report honest results, frame as "the alert you'd have gotten" (demand) not "the formula is right" (proof). And it's Wave-3/contingent — it does not block the distribution work (Specs 01/02) that actually moves demand.
- *"Why templatize before knowing the events?"* — the templatization is pure code (no data risk) and is the prerequisite that makes any future event cheap; it's worth doing in Wave 1 even if event selection slips on data availability.
- *"Data availability could kill the events"* — yes; that's why the `--capture` dry-run is the explicit gate before committing any fixture. If both events lack minute data, ship only the templatization + revisit candidates.
