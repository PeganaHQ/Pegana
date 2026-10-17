# Tier 1 Asset Expansion — Implementation Plan (data-only, 33 assets)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 33 net-new assets (6 stables + eUSX + PST + 25 Sanctum LSTs) to Pegana via config + one migration, reusing existing code-paths — zero new Rust logic.

**Architecture:** Append `[[assets]]` blocks + `[pyth_feeds]` + `[pyth_staleness.overrides]` to `assets.toml`; insert matching rows into `public.assets` via migration `0053`; a new guard test proves every Pyth-fed asset's feed is registered (the failure mode that would otherwise leave 7 assets at UNKNOWN). Engine/indexer pick the assets up from `assets.toml` at restart.

**Tech stack:** TOML config, PostgreSQL/TimescaleDB migration, `cargo test` (Rust guard test), `cargo xtask verify-assets`, `scripts/deploy.sh --migrate`.

**Spec:** `docs/superpowers/specs/2026-06-23-asset-expansion-design.md` (v2, grilled). Every mint/feed/symbol below was on-chain/Hermes-verified.

---

## File structure
- **Modify** `assets.toml` — 33 `[[assets]]` blocks (Task 2); 7 `[pyth_feeds]` + 2 `[pyth_staleness.overrides]` (Task 3).
- **Create** `migrations/0053_asset_expansion.sql` — 33-row upsert (Task 5).
- **Modify** `crates/indexer-rs/src/sources/pyth.rs` (test module) — feed-coverage guard test (Task 1).
- **Create** `docs/operations/asset-expansion-2026-06-23.md` — activation note (Task 9).

---

## Task 1: Feed-coverage guard test (the safety net)

**Files:**
- Modify: `crates/indexer-rs/src/sources/pyth.rs` (the `#[cfg(test)] mod tests` block; mirror the existing `assets_toml_wires_usdy_to_usdy_rr_feed` test for the assets.toml loader path it uses).

- [ ] **Step 1: Write the test**

```rust
/// Guard: every asset whose intrinsic/market is Pyth-fed MUST have its feed
/// name registered in `[pyth_feeds]`, or the indexer never subscribes to it
/// and the asset locks at UNKNOWN. verify-assets does NOT catch this.
#[test]
fn every_pyth_fed_asset_feed_is_registered() {
    let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../assets.toml"))
        .expect("read assets.toml");
    let af: pegana_common::AssetsFile = toml::from_str(&raw).expect("parse assets.toml");
    let registered: std::collections::HashSet<&str> = af.pyth_feeds.keys().map(|s| s.as_str()).collect();
    let mut missing = Vec::new();
    for a in &af.assets {
        if !a.active {
            continue;
        }
        if let pegana_common::IntrinsicStrategy::PythRedemptionRate { feed }
        | pegana_common::IntrinsicStrategy::PythFxCross { feed, .. } = &a.intrinsic
        {
            if !registered.contains(feed.as_str()) {
                missing.push(format!("{} intrinsic feed {}", a.symbol, feed));
            }
        }
        if let pegana_common::MarketStrategy::PythSpot { feed } = &a.market {
            if !registered.contains(feed.as_str()) {
                missing.push(format!("{} market feed {}", a.symbol, feed));
            }
        }
    }
    assert!(missing.is_empty(), "unregistered Pyth feeds: {missing:?}");
}
```

- [ ] **Step 2: Run the test — confirm it PASSES on the current tree**

Run: `cargo test -p indexer-rs every_pyth_fed_asset_feed_is_registered`
Expected: PASS (all current assets already have their feeds in `[pyth_feeds]`). If the import paths differ (`pegana_common` re-exports), adjust to match `crates/common/src/lib.rs` exports surfaced in the existing pyth tests.

- [ ] **Step 3: Commit**

```bash
git add crates/indexer-rs/src/sources/pyth.rs
git commit -m "test(indexer): guard that every Pyth-fed asset feed is registered in [pyth_feeds]"
```

---

## Task 2: Add the 33 asset blocks (test goes RED)

**Files:**
- Modify: `assets.toml` — insert the 33 `[[assets]]` blocks right after the last existing `[[assets]]` block (the vSOL block ending ~line 641), i.e. BEFORE the `[pyth_feeds]` table (~line 647). (Appending after `[pyth_feeds]`/`[pyth_staleness]` also parses, but inserting with the other asset blocks is cleaner.)

- [ ] **Step 1: Append the 6 stables + eUSX + PST blocks**

```toml
[[assets]]
symbol = "USX"
name = "Solstice USX"
mint = "6FrrzDk5mQARGc1TDYoyVnSyRdds1t4PbtohCD6p3tgG"
verified = true
decimals = 6
token_program = "spl"
class = "stable_dn"
peg_target = "USD"
intrinsic = { kind = "fixed_1_usd" }
market = { kind = "pyth_spot", feed = "USX/USD" }
pyth_feed_id = "0x80950327494d0e7f29bdddb061ed7d1def1d712cec73bc167af02f0664137a16"
thresholds_bps = { drift = 25, depeg = 100, critical = 300 }

[[assets]]
symbol = "USDG"
name = "Global Dollar"
mint = "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH"
verified = true
decimals = 6
token_program = "token_2022"
class = "stable_fiat"
peg_target = "USD"
intrinsic = { kind = "fixed_1_usd" }
market = { kind = "pyth_spot", feed = "USDG/USD" }
pyth_feed_id = "0xdaa58c6a3ce7d4b9c46c32a6e646012c17c4a2b24c08dd8c5e476118b855a7da"
thresholds_bps = { drift = 15, depeg = 50, critical = 200 }

[[assets]]
symbol = "USD1"
name = "World Liberty Financial USD"
mint = "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB"
verified = true
decimals = 6
token_program = "spl"
class = "stable_fiat"
peg_target = "USD"
intrinsic = { kind = "fixed_1_usd" }
market = { kind = "pyth_spot", feed = "USD1/USD" }
pyth_feed_id = "0x0a2425d43486780990d8b63543029e20556be51fd756cca584212f4d539611d4"
thresholds_bps = { drift = 20, depeg = 75, critical = 250 }

[[assets]]
symbol = "USDu"
name = "USDu"
mint = "9ckR7pPPvyPadACDTzLwK2ZAEeUJ3qGSnzPs8bVaHrSy"
verified = true
decimals = 6
token_program = "token_2022"
class = "stable_fiat"
peg_target = "USD"
intrinsic = { kind = "fixed_1_usd" }
market = { kind = "pyth_spot", feed = "USDu/USD" }
pyth_feed_id = "0x9c26b01925ed603f7c90deb29cd88751c580436333a7dca20a64a2c63785f502"
thresholds_bps = { drift = 25, depeg = 100, critical = 300 }

[[assets]]
symbol = "CASH"
name = "CASH (Bridge)"
mint = "CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH"
verified = true
decimals = 6
token_program = "token_2022"
class = "stable_fiat"
peg_target = "USD"
intrinsic = { kind = "fixed_1_usd" }
market = { kind = "jupiter_usd", numeraire = "USDC", numeraire_feed = "USDC/USD" }
pyth_feed_id = ""
thresholds_bps = { drift = 25, depeg = 100, critical = 300 }

[[assets]]
symbol = "AUSD"
name = "Agora Dollar"
mint = "AUSD1jCcCyPLybk1YnvPWsHQSrZ46dxwoMniN4N2UEB9"
verified = true
decimals = 6
token_program = "token_2022"
class = "stable_fiat"
peg_target = "USD"
intrinsic = { kind = "fixed_1_usd" }
market = { kind = "pyth_spot", feed = "AUSD/USD" }
pyth_feed_id = "0xd9912df360b5b7f21a122f15bdd5e27f62ce5e72bd316c291f7c86620e07fb2a"
thresholds_bps = { drift = 20, depeg = 75, critical = 250 }

[[assets]]
symbol = "eUSX"
name = "Solstice Earn USX"
mint = "3ThdFZQKM6kRyVGLG48kaPg5TRMhYMKY1iCRa9xop1WC"
verified = true
decimals = 6
token_program = "spl"
class = "stable_yield"
peg_target = "USD"
intrinsic = { kind = "pyth_redemption_rate", feed = "EUSX/USX.RR" }
market = { kind = "jupiter_usd", numeraire = "USDC", numeraire_feed = "USDC/USD" }
pyth_feed_id = ""
thresholds_bps = { drift = 50, depeg = 200, critical = 500 }

[[assets]]
symbol = "PST"
name = "Huma PayFi Strategy Token"
mint = "59obFNBzyTBGowrkif5uK7ojS58vsuWz3ZCvg6tfZAGw"
verified = true
decimals = 6
token_program = "spl"
class = "stable_yield"
peg_target = "USD"
intrinsic = { kind = "pyth_redemption_rate", feed = "PST/USDC.RR" }
market = { kind = "dex_screener_usd" }
pyth_feed_id = ""
thresholds_bps = { drift = 30, depeg = 100, critical = 250 }
```

- [ ] **Step 2: Append the 25 LST blocks**

For each row in the table, emit this block (substituting `<SYM>`/`<NAME>`/`<MINT>`; `intrinsic.symbol` == `symbol`):
```toml
[[assets]]
symbol = "<SYM>"
name = "<NAME>"
mint = "<MINT>"
verified = true
decimals = 9
token_program = "spl"
class = "lst"
peg_target = "SOL"
intrinsic = { kind = "sanctum_lst", symbol = "<SYM>" }
market = { kind = "jupiter_usd", numeraire = "SOL", numeraire_feed = "SOL/USD" }
pyth_feed_id = ""
thresholds_bps = { drift = 55, depeg = 140, critical = 300 }
```

| SYM | NAME | MINT |
|---|---|---|
| BNSOL | Binance Staked SOL | `BNso1VUJnh4zcfpZa6986Ea66P6TCp59hvtNJ8b1X85` |
| dynoSOL | dynoSOL | `DYNoyS3x5qgbccZg7RPXagm4xQzfnm5iwd9o8pMyJtdE` |
| PSOL | Phantom Staked SOL | `pSo1f9nQXWgXibFtKf7NWYxb5enAM4qfP6UJSiXRQfL` |
| JSOL | JPOOL Solana Token | `7Q2afV64in6N6SeZsAAB81TJzwDoD6zpqmHkzi9Dcavn` |
| hSOL | Helius Staked SOL | `he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A` |
| edgeSOL | Edgevana Staked SOL | `edge86g9cVz87xcpKpy3J77vbp4wYd9idEV562CCntt` |
| jagSOL | JagPool Staked SOL | `jag58eRBC1c88LaAsRPspTMvoKJPbnzw9p9fREzHqyV` |
| definSOL | Definity Staked SOL | `DEF1NXSZ8Th9n28hYBayrFtx9bj1EwwTiy3mhHEB9oyA` |
| sharkSOL | SharkPool Staked SOL | `BdMLRC2gKyFu8FRBErazzpEaKmB1jcVB9Eq1rXXFm4EV` |
| BulkSOL | BULK Staked SOL | `BULKoNSGzxtCqzwTvg5hFJg8fx6dqZRScyXe5LYMfxrn` |
| bonkSOL | bonkSOL | `BonK1YhkXEGLZzwtcvRTip3gAL9nCeQD7ppZBLXhtTs` |
| cgntSOL | Cogent SOL | `CgnTSoL3DgY9SFHxcLj6CgCgKKoTBr6tp4CPAEWy25DE` |
| LST | Liquid Staking Token (Marginfi) | `LSTxxxnJzKDFSLr4dUkPcmCf5VyryEqzPLz5j4bpxFp` |
| CDCSOL | Crypto.com Staked SOL | `CDCSoLckzozyktpAp9FWT3w92KFJVEUxAU7cNu2Jn3aX` |
| bpSOL | bpSOL | `BPSoLzmLQn47EP5aa7jmFngRL8KC3TWAeAwXwZD8ip3P` |
| haSOL | Hanabi Staked SOL | `haSo1Vz5aTsqEnz8nisfnEsipvbAAWpgzRDh2WhhMEh` |
| laineSOL | Laine Stake Token | `LAinEtNLgpmCP9Rvsf5Hn8W6EhNiKLZQti1xfWMLy6X` |
| xandSOL | Xandeum Staked SOL | `XAnDeUmMcqFyCdef9jzpNgtZPjTj3xUMj9eXKn2reFN` |
| raiSOL | Rakurai Staked SOL | `Ra1so1sTkvX3PorAM9ewqrsUMz9sPSbfFZ5oZUjN4oc` |
| picoSOL | picoSOL | `picobAEvs6w7QEknPce34wAE4gknZA9v5tTonnmHYdX` |
| mangoSOL | Mango Staked SOL | `MangmsBgFqJhW4cLUR9LxfVgMboY1xAoP8UUBiWwwuY` |
| iASOL | inshAllah SOL | `HALALGvdNJ8u1J3uFFSsba1tyYPRF3vnYfCQ3CpJasfD` |
| lanternSOL | Lantern Staked SOL | `LnTRntk2kTfWEY6cVB8K9649pgJbt6dJLS1Ns1GZCWg` |
| RoXSOL | RockawayX Staked SOL | `roxDFxTFHufJBFy3PgzZcgz6kwkQNPZpi9RfpcAv4bu` |
| proSOL | ProStaking SOL | `jucy5XJ76pHVvtPZb5TKRcGQExkwit2P5s4vY8UzmpC` |

- [ ] **Step 3: Run the guard test — confirm it FAILS (red)**

Run: `cargo test -p indexer-rs every_pyth_fed_asset_feed_is_registered`
Expected: FAIL — `unregistered Pyth feeds: ["USX market feed USX/USD", "USDG market feed USDG/USD", "USD1 market feed USD1/USD", "USDu market feed USDu/USD", "AUSD market feed AUSD/USD", "eUSX intrinsic feed EUSX/USX.RR", "PST intrinsic feed PST/USDC.RR"]`. This proves the guard works.

---

## Task 3: Register the 7 feeds + 2 staleness overrides (test goes GREEN)

**Files:**
- Modify: `assets.toml` `[pyth_feeds]` (table at ~line 647) and `[pyth_staleness.overrides]` (table at ~line 702).

- [ ] **Step 1: Append to `[pyth_feeds]`**

```toml
"USX/USD"     = "0x80950327494d0e7f29bdddb061ed7d1def1d712cec73bc167af02f0664137a16"
"USDG/USD"    = "0xdaa58c6a3ce7d4b9c46c32a6e646012c17c4a2b24c08dd8c5e476118b855a7da"
"USD1/USD"    = "0x0a2425d43486780990d8b63543029e20556be51fd756cca584212f4d539611d4"
"USDu/USD"    = "0x9c26b01925ed603f7c90deb29cd88751c580436333a7dca20a64a2c63785f502"
"AUSD/USD"    = "0xd9912df360b5b7f21a122f15bdd5e27f62ce5e72bd316c291f7c86620e07fb2a"
"EUSX/USX.RR" = "0xf36e12e65d2969b242fb97d3ebaa32ec55d5794189b64d1a07dc4f41425c9378"
"PST/USDC.RR" = "0x675e36f84a6be779ed793c71eb5c03151e1866c125767f46933626e0610af84d"
```

- [ ] **Step 2: Append to `[pyth_staleness.overrides]`** (`.RR` feeds step daily; mirror the SUSDE/SYRUPUSDC 36h overrides)

```toml
"EUSX/USX.RR" = 129600
"PST/USDC.RR" = 129600
```

- [ ] **Step 3: Run the guard test — confirm it PASSES (green)**

Run: `cargo test -p indexer-rs every_pyth_fed_asset_feed_is_registered`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add assets.toml
git commit -m "feat(assets): add 33 Tier-1 assets (6 stables + eUSX + PST + 25 LSTs) with Pyth feed registration"
```

---

## Task 4: verify-assets (on-chain gate)

- [ ] **Step 1: Run verify-assets** (needs live mainnet RPC + Sanctum reachability)

Run (from repo root, so the default relative `assets.toml` resolves): `cargo run -p xtask -- verify-assets`
Expected: PASS — every mint's owner matches `token_program`, decimals match, and all 25 `sanctum_lst` symbols resolve in Sanctum `/v1/lsts`. If a `token_program` mismatch appears for any LST, flip that row `spl`↔`token_2022` and re-run (none expected — all 25 verified `spl`).

---

## Task 5: Migration 0053

**Files:**
- Create: `migrations/0053_asset_expansion.sql`

- [ ] **Step 1: Write the migration** — one `INSERT … VALUES (…) ON CONFLICT (symbol) DO UPDATE SET …` for all 33 rows. Header + DO-UPDATE clause copied verbatim from `migrations/0047_phase0_activation.sql:103-117`. Column order: `symbol, mint, name, class, peg_target, decimals, token_program, intrinsic_kind, intrinsic_cfg, market_kind, market_cfg, pyth_feed_id, thresholds, is_active, metadata`. Per-row rules:
  - `intrinsic_cfg`: `'{}'::jsonb` (fixed_1_usd) · `'{"symbol":"<SYM>"}'::jsonb` (sanctum_lst) · `'{"feed":"EUSX/USX.RR"}'::jsonb` / `'{"feed":"PST/USDC.RR"}'::jsonb`.
  - `market_cfg`: `'{"feed":"<X>/USD"}'::jsonb` (pyth_spot) · `'{"numeraire":"USDC","numeraire_feed":"USDC/USD"}'::jsonb` or `'{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb` (jupiter_usd) · `'{}'::jsonb` (dex_screener_usd, PST).
  - `pyth_feed_id`: the hex for the 5 pyth_spot stables; `''` for the rest.
  - `thresholds`: `'{"drift_bps":N,"depeg_bps":N,"critical_bps":N}'::jsonb` (values from the asset block).
  - `metadata`: `'{"monitoring_only":true,"added":"2026-06-23 asset-expansion batch"}'::jsonb`.
  - `is_active`: `TRUE`.

Representative rows (write all 33 following these):
```sql
-- 0053: Asset expansion (2026-06-23). assets.toml is the engine/indexer source
-- of truth; the snapshot hypertables FK into public.assets, so materialize the
-- 33 new assets here. All monitoring-grade (beta) with provisional thresholds.
INSERT INTO assets (
  symbol, mint, name, class, peg_target, decimals, token_program,
  intrinsic_kind, intrinsic_cfg, market_kind, market_cfg,
  pyth_feed_id, thresholds, is_active, metadata
)
VALUES
  ('USX','6FrrzDk5mQARGc1TDYoyVnSyRdds1t4PbtohCD6p3tgG','Solstice USX','stable_dn','USD',6,'spl',
   'fixed_1_usd','{}'::jsonb,'pyth_spot','{"feed":"USX/USD"}'::jsonb,
   '0x80950327494d0e7f29bdddb061ed7d1def1d712cec73bc167af02f0664137a16',
   '{"drift_bps":25,"depeg_bps":100,"critical_bps":300}'::jsonb,TRUE,
   '{"monitoring_only":true,"added":"2026-06-23 asset-expansion batch"}'::jsonb),
  ('USDG','2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH','Global Dollar','stable_fiat','USD',6,'token_2022',
   'fixed_1_usd','{}'::jsonb,'pyth_spot','{"feed":"USDG/USD"}'::jsonb,
   '0xdaa58c6a3ce7d4b9c46c32a6e646012c17c4a2b24c08dd8c5e476118b855a7da',
   '{"drift_bps":15,"depeg_bps":50,"critical_bps":200}'::jsonb,TRUE,
   '{"monitoring_only":true,"added":"2026-06-23 asset-expansion batch"}'::jsonb),
  ('CASH','CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH','CASH (Bridge)','stable_fiat','USD',6,'token_2022',
   'fixed_1_usd','{}'::jsonb,'jupiter_usd','{"numeraire":"USDC","numeraire_feed":"USDC/USD"}'::jsonb,
   '','{"drift_bps":25,"depeg_bps":100,"critical_bps":300}'::jsonb,TRUE,
   '{"monitoring_only":true,"added":"2026-06-23 asset-expansion batch"}'::jsonb),
  ('eUSX','3ThdFZQKM6kRyVGLG48kaPg5TRMhYMKY1iCRa9xop1WC','Solstice Earn USX','stable_yield','USD',6,'spl',
   'pyth_redemption_rate','{"feed":"EUSX/USX.RR"}'::jsonb,'jupiter_usd','{"numeraire":"USDC","numeraire_feed":"USDC/USD"}'::jsonb,
   '','{"drift_bps":50,"depeg_bps":200,"critical_bps":500}'::jsonb,TRUE,
   '{"monitoring_only":true,"added":"2026-06-23 asset-expansion batch"}'::jsonb),
  ('PST','59obFNBzyTBGowrkif5uK7ojS58vsuWz3ZCvg6tfZAGw','Huma PayFi Strategy Token','stable_yield','USD',6,'spl',
   'pyth_redemption_rate','{"feed":"PST/USDC.RR"}'::jsonb,'dex_screener_usd','{}'::jsonb,
   '','{"drift_bps":30,"depeg_bps":100,"critical_bps":250}'::jsonb,TRUE,
   '{"monitoring_only":true,"added":"2026-06-23 asset-expansion batch"}'::jsonb),
  ('BNSOL','BNso1VUJnh4zcfpZa6986Ea66P6TCp59hvtNJ8b1X85','Binance Staked SOL','lst','SOL',9,'spl',
   'sanctum_lst','{"symbol":"BNSOL"}'::jsonb,'jupiter_usd','{"numeraire":"SOL","numeraire_feed":"SOL/USD"}'::jsonb,
   '','{"drift_bps":55,"depeg_bps":140,"critical_bps":300}'::jsonb,TRUE,
   '{"monitoring_only":true,"added":"2026-06-23 asset-expansion batch"}'::jsonb)
  -- … USD1, USDu, AUSD (like USDG) … and the remaining 24 LSTs (like BNSOL) …
ON CONFLICT (symbol) DO UPDATE SET
  mint = EXCLUDED.mint, name = EXCLUDED.name, class = EXCLUDED.class,
  peg_target = EXCLUDED.peg_target, decimals = EXCLUDED.decimals,
  token_program = EXCLUDED.token_program, intrinsic_kind = EXCLUDED.intrinsic_kind,
  intrinsic_cfg = EXCLUDED.intrinsic_cfg, market_kind = EXCLUDED.market_kind,
  market_cfg = EXCLUDED.market_cfg, pyth_feed_id = EXCLUDED.pyth_feed_id,
  thresholds = EXCLUDED.thresholds, is_active = EXCLUDED.is_active,
  metadata = assets.metadata || EXCLUDED.metadata;
```

- [ ] **Step 2: Apply against the prod-local DB and verify row count**

Run: `psql "$DATABASE_URL" -f migrations/0053_asset_expansion.sql && psql "$DATABASE_URL" -c "SELECT count(*) FROM assets WHERE metadata->>'added' LIKE '2026-06-23%';"`
Expected: `33`. (Use the prod-local stack DB on :5434, per project dev workflow.)

---

## Task 6: Full check + commit

- [ ] **Step 1: fmt + clippy + test**

Run: `cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`
Expected: all green (the new guard test + existing suite).

- [ ] **Step 2: Commit the migration**

```bash
git add migrations/0053_asset_expansion.sql
git commit -m "feat(db): migration 0053 — materialize 33 Tier-1 expansion assets"
```

---

## Task 7: Deploy + post-deploy verification

- [ ] **Step 1: Set Jupiter concurrency on the prod host.** In `~/pegana/.env` on `${PEGANA_DEPLOY_SERVER}`: **`JUPITER_MAX_CONCURRENT=2`** (works on the current keyed FREE tier — no payment needed; ~60s cycle for 48 jupiter assets). Code default is 1 — do not rely on it. ⚠️ The keyed free tier ends **2026-06-30**: after that, either go paid (then `=4` → ~30s) or drop to keyless `=1` (~120s). Bumping to 4 is OPTIONAL (latency only), not required.

- [ ] **Step 2: Deploy with migration**

Run: `scripts/deploy.sh --migrate`
Expected: migration `0053` applies BEFORE engine/indexer restart (FK + engine reloads `assets.toml` only at boot).

- [ ] **Step 3: Verify all 33 leave UNKNOWN**

Run: `curl -s https://api.pegana.xyz/v1/assets | python3 -c "import json,sys; d=json.load(sys.stdin); new=['USX','USDG','USD1','USDu','CASH','AUSD','eUSX','PST','BNSOL','dynoSOL','PSOL','JSOL','hSOL','edgeSOL','jagSOL','definSOL','sharkSOL','BulkSOL','bonkSOL','cgntSOL','LST','CDCSOL','bpSOL','haSOL','laineSOL','xandSOL','raiSOL','picoSOL','mangoSOL','iASOL','lanternSOL','RoXSOL','proSOL']; m={a['symbol']:a.get('state') for a in d}; [print(s, m.get(s,'ABSENT')) for s in new]"`
Expected: each transitions `UNKNOWN → PEGGED` within ~1–2 cycles. The 7 Pyth/RR assets (USX/USDG/USD1/USDu/AUSD/eUSX/PST) reaching PEGGED proves the `[pyth_feeds]` registration worked. Investigate any that stay UNKNOWN.

- [ ] **Step 4: Confirm Jupiter cycle latency** in indexer logs (`effective_rps` ~0.8 at conc=2; full cycle ~60s for 48 jupiter assets — acceptable for monitoring_only beta).

---

## Task 8: Ops note + final commit

**Files:**
- Create: `docs/operations/asset-expansion-2026-06-23.md`

- [ ] **Step 1: Write the activation note** (mirror `docs/operations/phase0-activation-2026-06-11.md`): the 33 assets, monitoring_only rationale, provisional thresholds, the `[pyth_feeds]` dependency, the 7-day recalibration window, and the Jupiter conc=4 prerequisite.

- [ ] **Step 2: Commit**

```bash
git add docs/operations/asset-expansion-2026-06-23.md
git commit -m "docs(ops): Tier-1 asset-expansion activation note (2026-06-23)"
```

---

## Rollback
`UPDATE assets SET is_active=FALSE WHERE metadata->>'added' LIKE '2026-06-23%';` + `git revert` the assets.toml commits + `scripts/deploy.sh --config-only`. Migration is idempotent via `ON CONFLICT`.

## Self-review
- ✅ Every spec §1 requirement → a task (asset blocks T2, feeds/staleness T3, migration T5, verify T4, deploy+verify T7).
- ✅ The v1 fatal gap ([pyth_feeds]) is the explicit red→green of T1–T3, guarded by a permanent test.
- ✅ No placeholders: exact mints, feed IDs, thresholds, SQL, commands. (The migration's "… remaining rows …" is a DRY note over a fully-specified per-row rule + 6 worked examples — every row is determined.)
- ✅ Types consistent with `crates/common/src/lib.rs` enums (verified in spec §1.2).
- ⚠️ Deploy-time only: set `JUPITER_MAX_CONCURRENT=2` (free keyed tier, ~60s, no payment). Optional `=4` (paid) → ~30s. Free tier ends 2026-06-30. Not a code blocker.
