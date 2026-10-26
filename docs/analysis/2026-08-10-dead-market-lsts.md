# Assets with no tradeable market (first measurement, 2026-08-10)

**Status:** finding, awaiting a decision. No asset was deactivated. Deactivation
edits `assets.toml`, which re-hashes the snapshot that goes into every receipt,
so it is a registry decision for the operator, not an implementation detail.

## What is new

Until today Pegana had no volume data and no holder data for any asset. The
`tokens_xyz_risk` source (migration 0075) now supplies liquidity, 24h volume and
holder count for 62 of 69 active assets, and `market_score.rs` reduces those to
a 0-100 market-DEPTH score answering one question: *is the quoted price
executable?*

The first production measurement says: **for 18 of 62 covered assets (29%), the
answer is effectively no.**

## The pattern that matters

Five assets carry very large liquidity and essentially zero trading:

| asset    | liquidity | 24h volume | holders | depth |
|----------|-----------|------------|---------|-------|
| dumSOL   | $132.0M   | $41        | 113     | 25    |
| dynoSOL  | $125.7M   | $12        | 76      | 25    |
| aeroSOL  | $83.3M    | $3         | 232     | 25    |
| GTSOL    | $50.2M    | $0         | 167     | 25    |
| definSOL | $22.0M    | $1         | 35      | 25    |

A pool this size with no flow is not a market. Pegana still publishes a peg
state for each of them, derived from a Jupiter quote against that pool. The
verdict may be arithmetically correct and practically meaningless: there is no
counterparty, so there is no price to be right about.

This is the failure mode the old hardcoded liquidity heuristic could not see at
all — it scored these assets by symbol, and none of them was on its list.

The genuinely thin tail is separate and smaller:

| asset    | liquidity | holders | depth |
|----------|-----------|---------|-------|
| sharkSOL | $143      | 35      | 1     |
| RoXSOL   | $4,208    | 33      | 2     |
| sUSD     | $8,124    | 17,124  | 14    |
| proSOL   | $10,492   | 3,002   | 16    |
| STKESOL  | $26,096   | 1,336   | 18    |
| USD*     | $3,123    | 8,984   | 20    |

Full set at depth <= 25: sharkSOL, RoXSOL, sUSD, proSOL, STKESOL, USD*, GTSOL,
aeroSOL, definSOL, dumSOL, dynoSOL, edgeSOL, haSOL, hyloSOL+, mangoSOL, raiSOL,
sctmSOL, AUSD.

## Independent corroboration on sharkSOL

`PeganaLstDirectoryFlagged` has been **firing since 2026-08-04** for sharkSOL
with `flag=stale` — lst-directory.com reports its backing rate has stopped
advancing. That alert's own description names the risk: *"a frozen-but-served
backing reads as a confident peg, the 2026-04-01 dSOL failure mode."*

Two independent signals now agree: the directory says the backing is frozen, and
the market data says there are 35 holders and $143 of liquidity. sharkSOL is the
strongest deactivation candidate in the set.

### What our own data does NOT show, and why that matters

An obvious next step is to confirm the frozen backing against Pegana's own
`intrinsic_snapshots`. That check was run and it does **not** corroborate the
directory. Recording it here so nobody repeats it as evidence:

- sharkSOL's `meta.sol_per_lst` has held one value (1.047125104) since
  2026-06-24. That looks damning in isolation.
- But the **median distinct `sol_per_lst` count across every Sanctum LST over 30
  days is 1**. JupSOL, bSOL, INF, BNSOL, PSOL and a dozen others are equally
  "frozen". JupSOL has held 1.18394498 unchanged from 2026-05-27 to 2026-08-10.
- Queried live during the investigation, Sanctum's `/v1/sol-value/current`
  returns byte-identical values to what Pegana stores for JupSOL, bSOL, INF and
  sharkSOL. Pegana is faithful to its source; nothing is stale on our side.

So a flat `sol_per_lst` is the normal state of this field across the whole LST
universe, not a death signal. It cannot distinguish a dead pool from a healthy
one, and any monitoring built on it would be blind. The sharkSOL case rests on
the two signals that ARE discriminating: the directory's own `stale` flag (which
fires for sharkSOL and no other tracked LST) and the measured market
($143 liquidity, 35 holders, no volume).

### What is actually published for it right now

`state: PEGGED`, `confidence: high`, `risk_score: 0` — the most reassuring
verdict the API can emit — for an asset with $143 of liquidity. It is already
`monitoring_only: true` and `calibration: provisional`, so it is excluded from
the calibrated denominator, but the public verdict still reads clean.

## What this does NOT claim

- Depth is **not** a peg score. `risk_score.rs` owns peg risk and is anchored to
  the committed FSM state. An asset can be perfectly pegged and completely
  illiquid; that is exactly what most of this table is.
- The thresholds behind these scores are a v1 calibrated against a single day of
  observation. The raw inputs are persisted in `liquidity_observations` with 90
  days of retention, so any revision can be backtested rather than guessed.
- Nothing here gates a verdict. The fields are inert by construction and
  `cargo xtask hygiene` fails the build if `engine-rs` or `methodology` so much
  as names them.

## Options

1. **Deactivate the clearly dead ones** (`active = false` in `assets.toml`, the
   dSOL precedent). Strongest case: sharkSOL. Removes a published verdict nobody
   can act on, and the historical snapshots are retained.
2. **Keep publishing but surface the caveat.** Already partly done: the asset
   page's liquidity dimension now reads the measured value and names the binding
   constraint, so a holder sees "dormant market" instead of a generic grade.
3. **Gate confidence on depth.** This is the depth gate (ADR-0026/0034), still
   shipped disabled with `DEPTH_GATE_FLOOR_USD=0`. Note the calibration data
   behind it previously covered only 26 of 69 assets, because it came from
   `market-snapshots`; the new source lifts that to 62 of 69, so the gate can
   now be calibrated against a real distribution instead of a third of one.
   Enabling it changes verdicts and therefore needs a methodology version bump
   and a backtest (see ADR-0044).

Recommended order: (1) for sharkSOL on the corroborated evidence, (2) is already
live, (3) only after a few weeks of observation now that coverage is real.

## Outcome for sharkSOL (2026-08-10)

Deactivated, migration 0076. The deciding evidence was neither the directory
flag nor the market reading on their own, but a direct on-chain read of the
stake pool at network epoch 1014:

| LST      | last_update_epoch | lag | total SOL  |
|----------|-------------------|-----|------------|
| laineSOL | 1014              | 0   | 12,278.68  |
| bSOL     | 1014              | 0   | 920,108.91 |
| sharkSOL | 1002              | 12  | **1.88**   |

Healthy pools update every epoch. sharkSOL had not updated in twelve, roughly a
month, and held 1.88 SOL total (~$142) — essentially the entire $143 of measured
"liquidity". Because `last_update_epoch` is frozen the rate cannot advance, and
Sanctum keeps serving the last value it computed, which is why Pegana stored a
rate matching its source exactly and still published PEGGED / high confidence /
risk_score 0.

Verified after deploy: `/v1/assets` count 68 → 67, sharkSOL absent, and
`PeganaLstDirectoryFlagged` cleared because the asset is no longer covered.

### Correction to migration 0076's comment

That migration says historical rows are preserved "so the asset page still
renders its timeline". The first half is true — 332,652 discount snapshots and
273,729 intrinsic snapshots are retained, so re-activation is lossless and
existing receipts stay reproducible. The second half is not: `/v1/assets/{symbol}`
returns 404 for every deactivated asset (verified for dSOL, pbUSDC, BRZ and
sharkSOL alike), so nothing renders. The claim was inherited from migration
0040's wording and is wrong there too.

It is corrected here rather than in the migration on purpose: 0076 is already
applied and `pegana_migration_ledger` stores its SHA-256. Editing an applied
migration changes that checksum and makes every subsequent deploy abort with
"Checksum mismatch". Never edit an applied migration; correct it downstream.
