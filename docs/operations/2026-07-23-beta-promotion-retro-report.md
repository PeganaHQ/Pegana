# Beta → Calibrated promotion — retro REPORT (2026-07-23, batch 2)

> **Executes the plan in** `docs/operations/2026-07-20-beta-promotion-retro-plan.md`.
> **Gate:** [ADR-0015](../adr/0015-calibration-v1-per-class-verdict.md) +
> [ADR-0029](../adr/0029-calibration-health-direction-sensitive.md) +
> [monitoring-only-promotion-criteria.md](monitoring-only-promotion-criteria.md).
> **Retro query:** `scripts/beta-promotion-retro.sql` (read-only; validated
> byte-clean against prod-local 2026-07-23 — `EXIT=0`, both sections parse).
> **Migration template:** `migrations/0060_promote_beta_assets_to_calibrated.sql`.
>
> **Status: VALIDATED — ready to deploy.** Prod retro-SQL run ✅ + Birdeye liquidity
> sweep ✅ + eUSX 1:1-corrected ✅ + Rafael's D6 overrides decided ✅. Migration `0069`
> materialized with the final **36** PROMOTE set (34 mechanical + hyloSOL+ & corvusSOL
> via D6 override; proSOL & STKESOL declined) → calibrated **20 → 56**. Validated
> against prod (flips exactly 36) + golden (`no drift ✓`, EXIT=0). Nothing deployed (founder).

---

## 1. Live baseline (verified 2026-07-23 via `GET /v1/assets` + `/v1/calibration`)

| | |
|---|---|
| Tracked (prod, current build) | **63** |
| Calibrated (`monitoring_only=false`) | **20** |
| Beta (`monitoring_only=true`) | **43** — **42 read `health: ok`**, 1 (`xSOL`) `miscalibrated` |

Distribution of the 43 betas: **31 lst · 4 stable_fiat · 6 stable_yield · 1 stable_dn
(USX) · 1 synth_lev (xSOL)**. Prod runs the old build → 63, not the canon 72; the
mig-0064 LSTs are NOT live yet (a future retro after V1 deploys + their own window,
per D3 of the plan).

---

## 2. The gate (ALL must hold, per-asset)

1. **Data completeness** — ≥7 distinct days in the trailing 8d window AND no
   snapshot gap > 6h (a source outage stops `discount_snapshots` being written).
   → retro SQL `days` + `max_gap_h`.
2. **Calibration** — `p95 |effective discount| < drift_bps`, direction-sensitive
   per ADR-0029 (== `/v1/calibration` `health: ok`). → retro SQL `p95_bps` vs `drift_bps`.
3. **Zero noise** — 0 transitions labelled false_positive/noisy in the window
   (there is **no label table** in the DB — verified 2026-07-23 — so this is a
   **manual** classification of retro-SQL Section B; a calm asset shows 0 transitions).
4. **Can the engine detect a real move?** — a **liquid, non-single-source market
   leg** (ADR-0024). A single-source constant discount reads PEGGED even during a
   real depeg → promoting it would be dishonest. Settled by `liq_usd` (DB tokens.xyz
   obs) + the Birdeye `token_overview` check (floor **$25 000**, ADR-0026), NOT by
   the market SOURCE alone (see §4).

---

## 3. Candidate pool = **40** (the 42 `ok`-betas − 2 hard exclusions)

**Hard exclusions (decided, no data needed):**
- **sHYUSD** (stable_yield, drift 30) — **HARD BLOCK.** Thin-Jupiter premium
  carve-out freezes PEGGED on garbage prints; needs the market-leg root-cause fix
  first (criteria step 5). API symbol `sHYUSD`; display `eHYUSD`.
- **xSOL** (synth_lev, drift 1500) — **PERMANENT beta.** Class C, sole survivor in
  class, wide bands by design (ADR-0015); also the 1 `miscalibrated`.

The remaining **40** go through the retro SQL + liquidity gate:

| Class | drift_bps | Candidates |
|---|---|---|
| **lst** (31) | 55 (most); 30 hyloSOL+ | BNSOL · BulkSOL · CDCSOL · JSOL · LST · PSOL · RoXSOL · STKESOL · bonkSOL · bpSOL · cgntSOL · corvusSOL · definSOL · dynoSOL · dzSOL · edgeSOL · hSOL · haSOL · **hyloSOL+** · iASOL · jagSOL · laineSOL · lanternSOL · mangoSOL · picoSOL · proSOL · raiSOL · rkuSOL · sharkSOL · vSOL · xandSOL |
| **stable_fiat** (4) | CASH 25 · USD1 20 · USDG 15 · USDu 25 | CASH · USD1 · USDG · USDu |
| **stable_yield** (5) | JLP 200 · ONyc 100 · PST 30 · USD* 50 · eUSX 50 | JLP · **ONyc** · PST · USD* · eUSX |
| **stable_dn** (1) | USX 25 | USX |

---

## 4. Frozen-signal / market-source analysis (the §2-step-4 check) — 1:1 findings

**Verified against `assets.toml` 2026-07-23.** Of all 40 candidates, the market leg
is `jupiter_usd` (real DEX-aggregator route) or `pyth_spot` (oracle feed). **NONE
use `dex_screener_usd`** (a single Raydium pool — the frozen-signal source class).
The only two `dex_screener_usd` assets in the whole file are **sUSD** and **pbUSDC**,
and **both are `active=false`** — neither is a candidate. So **there is no
config-level frozen-signal exclusion** in this batch.

**⚠️ Correction to the plan/criteria doc (stale):**
- **ONyc** — the criteria doc (2026-06-16) and the 07-20 plan list ONyc as
  "frozen-signal, single-source, EXCLUDE". That is **stale**: `assets.toml:455`
  shows its market leg was **switched from dex_screener → `jupiter_usd`
  (numeraire USDC) on 2026-07-01 — "deep on Jupiter; USDu pattern".** ONyc is
  **not** single-source anymore. Its promotion is a **liquidity-data decision**
  (retro SQL + Birdeye), not an automatic exclude.
- **hyloSOL+** — market leg is `jupiter_usd` (numeraire SOL), also not
  single-source *by config*. But it is an XP-focused LST with ~no secondary
  liquidity, so the Jupiter route can still be effectively constant. Its exclusion,
  if any, must come from the **liquidity gate** (`liq_usd` < $25k or a Birdeye
  thin/dust reading), not from a config claim. Same treatment as ONyc: **let the
  data decide.**

**Net:** hyloSOL+ and ONyc are **NOT pre-excluded** here (that was the handoff's
`~34` assumption). They enter the retro like every other candidate; the liquidity
gate (§2-step-4) decides them on real numbers.

**Prior Birdeye snapshot (2026-07-20, floor $25k) — to be RE-VERIFIED:** flagged
these as thin → likely HOLD: `RoXSOL` ($4.2k) · `STKESOL` ($22k, borderline) ·
`USD*` ($3.3k) · `eUSX` ($1.1k) · `sharkSOL` ($143 dust). The other 35 read deep.
This 3-day-old snapshot is an input, not a verdict — the retro SQL `liq_usd`
(tokens.xyz obs) + a fresh Birdeye pass settle it.

---

## 5. Per-asset results — PROD RUN 2026-07-23 (raw: `…-retro-PROD-OUTPUT.txt`)

**Decision rule (mechanical, ADR-0015):** PROMOTE ⟺ `days≥7` ∧ `max_gap_h≤6` ∧
`p95_bps<drift` ∧ `criticals=0` ∧ `0 noisy transitions` ∧ (`liq_usd≥$25k` ∨ Birdeye
≥$25k). Else HOLD (stays beta, honestly). Rafael may override any row (ADR-0015 D6).

**Global result: ALL 43 betas passed data-completeness — `days=9`, `max_gap_h=0.0`
(zero source outage).** Calibration (`p95<drift`) passed for every candidate. So the
decision reduces to **liquidity** + **noise**.

### ✅ PROMOTE — confirmed now (8): pass ALL gates incl. tokens.xyz liquidity ≥$25k
| Symbol | class | p95 | drift | trans | liq_usd (tokens.xyz) |
|---|---|---|---|---|---|
| BNSOL | lst | 0 | 55 | 0 | $788,551,333 |
| PSOL | lst | 0 | 55 | 0 | $126,473,815 |
| bpSOL | lst | 0 | 55 | 0 | $4,173,555 |
| CASH | stable_fiat | 6 | 25 | 0 | $7,562,440 |
| USD1 | stable_fiat | 14 | 20 | 0 | $435,806,747 |
| USDG | stable_fiat | 2 | 15 | 0 | $38,134,856 |
| USDu | stable_fiat | 11 | 25 | 0 | $4,363,447 |
| USX | stable_dn | 6 | 25 | 0 | $22,001,007 |

### ✅ PROMOTE — confirmed via Birdeye aggregated liquidity ≥$25k (26 more)
Birdeye `token_overview` sweep 2026-07-23 (raw: `/tmp` → summarized here; floor $25k).
All pass the DB gate (p95<drift, 0 crit, **0 transitions**) AND Birdeye liq ≥$25k:
`xandSOL · laineSOL · mangoSOL · lanternSOL · iASOL · picoSOL · raiSOL · edgeSOL · PST ·
haSOL · CDCSOL · cgntSOL · JLP · LST · ONyc · rkuSOL · bonkSOL · BulkSOL · definSOL ·
jagSOL · hSOL · vSOL · JSOL · dzSOL · dynoSOL · eUSX`
(range: hSOL $69.5M, JSOL $108M, dynoSOL $128M … down to xandSOL $522k. **ONyc $8.45M** —
confirms §4, not frozen-signal.)

**eUSX — 1:1 correction (included despite Birdeye):** Birdeye reported **$1,127**, but
that is a USDC-anchoring artifact — Birdeye only counts USDC-quoted liquidity. eUSX's
real market is **$9.2M** across **Orca ($4.69M) + Raydium ($4.54M) eUSX/USX pools**
(~$187k/24h volume, verified by direct DexScreener pair inspection), and the retro shows
a **moving discount (p95=13)** → a responsive, non-frozen, multi-venue leg. Clears the
$25k floor decisively. Included.

### ⚖️ D6 OVERRIDES — decided by Rafael (2026-07-23)
Mechanical default = HOLD (criteria step 3 "0 noisy transitions"). All liquid (Birdeye),
so only the noise gate held them; Rafael's ADR-0015 D6 call:
| Symbol | liq (Birdeye) | trans | Section-B pattern | p95/drift | Decision |
|---|---|---|---|---|---|
| hyloSOL+ | $964k | 2 | PEGGED→DRIFT 33 → 7 bps over ~3h (band-grazing; p99=31≈drift 30) | 15/30 | **✅ PROMOTE (override)** — mild real drift; responsive leg **disproves** frozen-signal |
| corvusSOL | $2.70M | 4 | 2× brief PEGGED↔DRIFT (88/60 bps), reverted 4–7 min | 16/55 | **✅ PROMOTE (override)** — rare tail spikes on a $2.7M leg, well inside the wide band |
| proSOL | $1.11M | 2 | PEGGED→DRIFT 107 → −98 bps in 5 min (isolated spike; p99=0 otherwise) | 0/55 | **⏸ HOLD** — single anomalous print; revisit after a clean window |

### 🚫 Excluded — thin liquidity / hard (9)
| Symbol | liq | Reason |
|---|---|---|
| eUSX→ | *(NOT excluded — see 1:1 correction above)* | |
| USD* | $3,105 (tokens.xyz) | **HOLD** — thin < $25k |
| RoXSOL | $4,208 (Birdeye) | **HOLD** — thin; retro p95=0 (near-constant, frozen-ish) |
| STKESOL | $22,598 (Birdeye) | **HOLD** — thin, near-miss < $25k (Rafael may override; p95=10 moving) |
| sharkSOL | $143 (Birdeye) | **HOLD** — dust |
| sHYUSD | — | **HARD-BLOCK** — market-leg fix first (criteria step 5) |
| xSOL | — | **PERMANENT** — Class C; 1 CRITICAL (real DEPEG→CRITICAL, by design) |

### 📊 Result (final)
- **36 PROMOTE (this migration): calibrated 20 → 56.** = 34 mechanical (8 tokens.xyz +
  26 Birdeye/1:1) + **hyloSOL+ & corvusSOL via D6 override**.
- **7 HOLD honestly:** proSOL (D6-declined, one clean window), USD*, RoXSOL, STKESOL,
  sharkSOL (thin) + sHYUSD (block) + xSOL (permanent).

---

## 6. Migration 0069 — MATERIALIZED + validated ✅

`migrations/0069_promote_beta_batch2_to_calibrated.sql` (the final 36-symbol set: 34 +
hyloSOL+ & corvusSOL via D6).
Mirror of mig 0060. Touches only `assets.metadata` → **golden byte-exact unaffected**
(the backtest replays the pinned `docs/backtests/.../assets-snapshot.toml`, not the live
config); idempotent; `deploy.sh --migrate --config-only`, no rebuild/recreate.

**No `assets.toml` edit needed** — verified 1:1 that the 42 current betas are flagged by
DB migration (mig-0053/0055/0064 metadata), NOT by `assets.toml` comments. Only 1
`# monitoring-only per ADR` annotation remains in the file (line ~275 = sHYUSD, which
correctly STAYS). So this migration is DB-only; `assets.toml` is untouched.

**Validated (2026-07-23, final 36-set):**
- **PROD read-only:** `SELECT count(*) … WHERE symbol IN (<36>) AND monitoring_only=true`
  → **36** (the migration will flip exactly 36 rows).
- **LOCAL (prod-local :5434):** applied inside `BEGIN; \i 0069; ROLLBACK;` → **`UPDATE 36`**,
  no error (syntax + execution proven, not persisted).
- **Golden:** `cargo run -q -p xtask -- backtest --check` → **`no drift ✓` (EXIT=0)**.
- clippy/fmt/unit-tests: unaffected (no Rust or `assets.toml` change). No
  `sqlx::migrate!()`/checksum test to update (migrations run via `sqlx migrate run` at deploy).

**Expected outcome:** calibrated **20 → 56** with one `--config-only` migration, no rebuild.
After deploy: `beta` badge drops on web / 🧪 footer on bot / `calibration:"provisional"`
on webhooks / REST rows; the calibrated denominator in `/v1/calibration` + `/v1/stats`
rises 20 → 56.

---

## 7. Who does what — remaining

1. **[founder]** `deploy.sh --migrate --config-only`. (Migration validated + ready; 36 rows.)
2. **[founder]** rotate the Birdeye key (it was used inline this session).
3. Post-deploy: verify `/v1/calibration` denominator = **56**.
4. Later: proSOL (revisit after a clean window) + the frozen-signal/thin holdouts
   (RoXSOL, STKESOL, sharkSOL, sHYUSD) via the depth-gate (Sub-B) once it ships.
