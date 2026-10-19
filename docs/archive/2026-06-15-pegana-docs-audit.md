<!-- Generated 2026-06-15 by the `pegana-full-audit` workflow (57 agents, 717 tool calls).
     P0/P1 findings adversarially verified (85/85 confirmed). Top claims independently
     spot-checked against source by the main session before publishing. -->

# Pegana Documentation-Currency & Project-Validation Audit

> **⚠️ CORRECTION (2026-06-15, post-audit).** This audit was run against the **live 0.3.0**
> system. The branch HEAD (`d86601f`, methodology **0.4.0**, ADR-0025) had already changed
> three of the behaviors this report flagged, so the following findings are **INVERTED** and
> were NOT applied as written — the docs were instead aligned to 0.4.0:
> - **BLACK_SWAN is now reachable from spread** (default `2× critical`), not CR-only. The
>   "5-state FSM" / "Five states" framing is **correct**; the report's "it's really 4 states /
>   bps tops at CRITICAL" finding is wrong against 0.4.0. UST `CRITICAL → BLACK_SWAN` **can** happen.
> - **BLACK_SWAN auto-exits via hysteresis** (it is NOT a no-reset terminal state). The report
>   was right that the "never auto-exits" copy needed softening — but the fix is softening, not removal.
> - **UNKNOWN is published on a broken anchor** (NAV-sanity, >10% premium on a NAV-priced asset),
>   in addition to cold-start. The "engine never emits UNKNOWN except cold-start" finding is too strong;
>   generic source staleness still holds the last state.
>
> Everything else in this report (asset count 21→26, MCP snake_case, webhook 5s timeout, exit dwell
> 120s, deadband 25%, hyUSD CR bands 130/115/105/100, launch banners, changelog gap, `class=stable_fiat`,
> etc.) was independently verified and **was** applied. See ADR-0025 §3 (which explicitly references this doc).

**Date:** 2026-06-15 · **Scope:** entire `docs-site/` (Mintlify) + live `pegana.xyz` / `api.pegana.xyz` + Rust workspace + web app · **Baseline HEAD:** `7325189`

---

## 1. Executive summary

The codebase is healthy; the documentation is not. Every runnable validation gate passed (Rust fmt/clippy/unit tests clean, web typecheck/lint/266 tests green, live API and web both serving real data). But the public docs-site has **drifted badly out of sync with the product since the 2026-06-11 launch**, and the drift is concentrated in exactly the two places that matter most for a trust/verifiability product: **what states the engine actually emits**, and **how it behaves on stale data**.

Two systemic, repeated errors run through the entire docs-site and account for most of the serious findings:

1. **The "flip to UNKNOWN on stale data" claim is false and pervasive.** Across the FAQ, all five methodology pages, and four concept pages, the docs promise that an asset "flips to `UNKNOWN`" when a source goes stale, fails to decode, or hits confidence=0. The engine does the **opposite**: it skips the recompute and **holds the last published state** (which could be a stale `PEGGED`). The `UNKNOWN`-on-stale feature was the freeze detector — shipped (`ee7301a`), reverted (`7aadf34`), and formally **Rejected in ADR-0024 one day before this audit (2026-06-14)**. The docs describe a feature that was built, ripped out, and rejected.

2. **The "spread-driven BLACK_SWAN" and "5-state FSM ending in UNKNOWN" framing is wrong.** `state_for_bps_discount` (the path 25 of 26 assets use) tops out at `CRITICAL` — it has no `black_swan` branch. `BLACK_SWAN` is reachable **only** via the CR path, wired solely for hyUSD. `UNKNOWN` is a cold-start fallback, never an emitted verdict. Yet the docs advertise BLACK_SWAN as a spread-reachable terminal state (including a UST case-study "CRITICAL → BLACK_SWAN" transition that cannot happen) and list UNKNOWN as a normal published state.

On top of those, the **`21 active assets` figure is stale everywhere** (true count is **26**, after the 2026-06-11 Phase-0 activation of JupUSD/JLP/EURC/dzSOL/vSOL), the **calibration/"gated until 2026-06-11" banners are 4 days in the past** (the system is live and public), the **changelog has a 2-week hole** missing the launch itself, the **MCP tool names are all camelCase but the server registers snake_case**, and the **webhook timeout is documented as 10s but is hard-coded to 5s**.

**Single most important takeaway:** The docs make falsifiable safety promises ("you will see `UNKNOWN` and should not act"; "BLACK_SWAN for any spread blowout") that the live engine does not keep. For a product whose entire pitch is verifiability, fix the UNKNOWN/BLACK_SWAN honesty gap and the launch-state banners **first** — they are the difference between accurate and actively misleading.

---

## 2. Verdict scorecard

| Dimension | Status | One-line justification |
|---|---|---|
| **Docs accuracy** | 🔴 | 4 confirmed P0s + 18 confirmed P1s; systemic false claims about UNKNOWN-on-stale and spread-driven BLACK_SWAN across 9 page groups. |
| **Build / tests** | 🟢 | `cargo fmt`/`clippy` clean; `pegana-common` 23/23 + `pegana-methodology` 48/48; web `tsc`/`eslint` clean + vitest 266/266. (DB/E2E suites skipped — Docker down.) |
| **Live API** | 🟡 | Healthy and serving real data (26 assets, all PEGGED, sources fresh), but contradicts docs: 26 not 21, `/readyz` not `/ready`, no rate-limit headers, no `active` field. |
| **Live web** | 🟡 | All pages load and match the API (screener reads "26 assets tracked live"); two issues: home page still says "public delivery opens … June 11, 2026" (past), and the unhydrated `/status` shell renders a false "Investigating an outage" to non-JS clients. |

---

## 3. P0 — must fix now

These are confirmed, user-facing, and flatly wrong. They are documentation-only (no code/security defect), but they misrepresent the engine's core safety behavior.

### P0-1 · "Flips to UNKNOWN on a Solana outage" — false
**Page:** `docs-site/faq.mdx` — accordion *"What happens during a Solana network outage?"* (lines 83–92)
**Wrong:** "The engine flips affected assets to `UNKNOWN` after 30 seconds of stale data. Subscribers see `UNKNOWN` and should not act."
**Correct:** The engine never flips to UNKNOWN on stale data. A stale source side returns `None` from `snapshot()` (`state.rs:407-440`) → the recompute is **skipped** and the **prior published state is held** (`main.rs:610-621/665-675`). `UNKNOWN` is only a cold-start fallback (`main.rs:763-766`). The freeze→UNKNOWN approach was rejected (ADR-0024); containment via `monitoring_only` is the mitigation.
**Exact correction** — replace the second paragraph:
> When a source side goes stale, the engine does **not** invent a value: it skips the recompute and holds the last published state rather than emitting a fresh verdict on degraded inputs. Stale assets are flagged via freshness buckets, and high-risk illiquid/single-source assets are contained as `monitoring_only` so a frozen signal cannot reach public alert egress. (UNKNOWN exists only as a cold-start fallback, not as a live stale-data verdict.)

### P0-2 · `state-machine.mdx` presents UNKNOWN as a live, actively-entered state
**Page:** `docs-site/concepts/state-machine.mdx` — frontmatter, "The five states" table, transition diagram (lines 3, 19, 37–38, 65–67)
**Wrong:** "`UNKNOWN` | Source stale, low-confidence, or decoder mismatch; sticky"; "any state can flip to UNKNOWN if source goes stale, and must dwell 60s after recovery"; frontmatter "5-state finite-state machine — PEGGED, DRIFT, DEPEG, CRITICAL, UNKNOWN".
**Correct:** Classification never returns `Unknown`; it is a cold-start default only. Stale/decoder-drift → skip recompute + hold prior state. There is no UNKNOWN re-entry/60s-dwell logic anywhere in code.
**Exact corrections:**
- Table row → `` `UNKNOWN` | Cold-start default before the first classified tick. Not actively emitted in normal operation. | No ``
- Delete the orthogonal-UNKNOWN diagram note (lines 65–67).
- "What each state implies" UNKNOWN bullet → "On stale/low-confidence/decoder-drift the engine **skips the recompute and holds the last published state** rather than flipping to UNKNOWN. Containment via `monitoring_only` is the mitigation for unreliable sources (ADR-0024)."
- Frontmatter → describe the alerting ladder (PEGGED/DRIFT/DEPEG/CRITICAL) and note UNKNOWN is a cold-start fallback.

### P0-3 · `hylo-cdp-cr-signal.mdx` CR band table is wrong on every row
**Page:** `docs-site/concepts/hylo-cdp-cr-signal.mdx` — floor prose (lines 27–34) + CR band table (lines 59–65)
**Wrong:** Table reads PEGGED ≥150%, DRIFT 130–150%, DEPEG 115–130%, CRITICAL 105–115%, BLACK_SWAN <105% (every band shifted up one). Prose also says "CR < 110% → critical" (matches nothing) and "CR < 100% → BLACK_SWAN" (inconsistent with its own table's <105%).
**Correct:** Live `assets.toml:228` = `drift=130, depeg=115, critical=105, black_swan=100`. Engine `state_for_cr` (`thresholds.rs:202-208`) maps these exactly.
**Exact correction** — table:
> PEGGED CR ≥ 130% · DRIFT 115% ≤ CR < 130% · DEPEG 105% ≤ CR < 115% · CRITICAL 100% ≤ CR < 105% · BLACK_SWAN CR < 100%

floor prose: "CR < 130% → Stability Mode / DRIFT", "CR < 105% → CRITICAL", "CR < 100% → BLACK_SWAN". Remove the stray "CR < 110% → critical". (The 150/130/110/100 fixtures from ADR-0021/0023 are **not** the live values — cite `assets.toml:228`.)

### P0-4 · MCP `getAssetHistory` doc params don't match the tool schema
**Page:** `docs-site/guides/mcp-paid-tools-x402.mdx` — `getAssetHistory` example + params (lines 22–34)
**Wrong:** Example uses `{ asset, bucket:'1m', from, to }`; documents `bucket=raw`, `from`/`to` ISO with "max range 7 days", `limit` 1–5000.
**Correct (`get-asset-history.ts` / `db.ts`):** Params are `symbol`, `bucket` ∈ `['1m','5m','15m','1h']` (no `raw`), `limit` 1–**50,000** default 1000. There are **no** `from`/`to` params. Lookback hard-bounded to **30 days** at SQL. This is a paid, real-mainnet-USDC tool — a copy-pasted call from this doc fails schema validation.
**Exact correction:**
```
// → get_asset_history({ symbol: "USDC", bucket: "5m", limit: 288 })
```
> - `symbol` — case-sensitive asset symbol (run `get_assets` to enumerate)
> - `bucket` — one of 1m / 5m / 15m / 1h (default 1m); there is no raw bucket
> - `limit` — rows, most-recent first, default 1000, hard-capped at 50,000
> - lookback window is 30 days; rows older than 30 days are never returned

Remove the `from`/`to`, "max range 7 days", and "1–5000" claims. (Note: the same wrong claims also appear at lines 17, 124, 127 — fix those too.)

> **Severity note on the re-graded P0→P1 items.** The adversarial pass downgraded several originally-tagged P0s to P1 because they are stale-but-not-dangerous (e.g. the "21 active" count, the inactive-entries list). Those now live in §4. The four above are the ones the verification pass confirmed *at P0*.

---

## 4. P1 — stale, fix this pass

Grouped by theme. All are confirmed.

### 4a. Launch-state banners — calibration windows that closed 4 days ago

| Page | Wrong | Correct fact |
|---|---|---|
| `docs-site/faq.mdx` "Is Pegana production-ready?" (50–59) | "in calibration as of 2026-06-01 … gated until 2026-06-11" | Live & public since 2026-06-11; verdict computed 2026-06-10. |
| `docs-site/guides/telegram-bot.mdx` top `<Note>` (6–11) | "Alerts are in calibration … switches on at the gate" | Alerts deliver now. |
| `docs-site/guides/webhooks.mdx` intro `<Note>` (6–11) | "Delivery is in calibration … gated until 2026-06-11" | Webhook delivery is live. |
| `pegana.xyz` home (live) | "public delivery opens at the verdict gate on June 11, 2026" | Past event — update to "alerts are now public". |

**Exact corrections:**
- **faq.mdx 50–59:** "Pegana Trust Layer v0.1.0 went **live and public on 2026-06-11**, after calibration v1 passed (verdict computed 2026-06-10). The read paths (REST, WebSocket, MCP) and the public alert channels (Telegram bot, webhooks) are all live. It is in a post-launch stability lock through 2026-06-25. Production deploy: Hetzner CPX32, all services healthy."
- **telegram-bot.mdx:** delete lines 6–11, or replace with: `<Note> Alerts are live. The bot delivers state-transition notifications to subscribers in real time, alongside lookups (/status, /explain, /history). </Note>`
- **webhooks.mdx:** delete the `<Note>`, or: `<Note>**Live since 2026-06-11.** Registration, signing, test events, replay, and production delivery to public endpoints are all active. Calibration v1 shipped on 2026-06-10; the public-alerts gate flipped on 2026-06-11.</Note>`

### 4b. The UNKNOWN-on-stale and BLACK_SWAN claims (same systemic errors as P0, lower-blast-radius pages)

| Page / location | Wrong | Correct |
|---|---|---|
| `methodology/honesty.mdx`, `market-value.mdx`, `intrinsic-value.mdx`, `spread.mdx` — every "flips to UNKNOWN" line | engine actively emits UNKNOWN on stale/failed/IDL-drift input | engine **skips recompute, holds last published state**; UNKNOWN is cold-start only |
| `methodology/overview.mdx` (3, 14–16, 48–59) | "5-state FSM … Plus BLACK_SWAN for spreads beyond any historically-observed level"; description also self-contradicts ("Four states" vs "5-state") | BLACK_SWAN reachable **only** on CR path (hyUSD); bps path tops out at CRITICAL; reconcile the 4-vs-5 count |
| `methodology/spread.mdx` "What the FSM guarantees" (113–114) | "BLACK_SWAN (spread beyond p99.9) … requires manual `/v1/me/alerts/:id/ack`" | spread path can't reach BLACK_SWAN; **`/v1/me/alerts/:id/ack` does not exist** (delete it) |
| `concepts/hysteresis-fsm.mdx` (3, 23–57, 79) | BLACK_SWAN spread-reachable; UNKNOWN active; **exit dwell "60s"** | BLACK_SWAN CR-only; UNKNOWN cold-start; exit dwell is **120s** (`DECAY_DOWN_SECS=120`) |
| `concepts/state-machine.mdx` (46–47, 65–72) | "exit dwell is 60s" / "60s @ < drift-exit" | **120s** everywhere; entry dwell 30s is correct |
| `concepts/confidence-score.mdx` (35–48, 98–104) | three "(asset flips to UNKNOWN)" parentheticals + "stays there for ≥60s" | low score lowers the `confidence` field only; engine holds last state; no UNKNOWN emit; dwell is 120s not 60s |
| `concepts/hylo-cdp-cr-signal.mdx` IDL-drift (71–76) | "Pegana flips hyUSD to `UNKNOWN` and emits a Sentry alert" | skips recompute, holds last good CR; **no UNKNOWN flip, and verify the Sentry claim** — that path emits only a warn log + Prometheus counter, no Sentry call |
| `case-studies/ust-collapse-may-2022.mdx` (29, 44–45) | "`CRITICAL → BLACK_SWAN` … BLACK_SWAN never auto-exits" | a spread-priced asset tops out at **CRITICAL**; never BLACK_SWAN |

**Representative exact corrections:**
- **spread.mdx 113–114:** "BLACK_SWAN is reachable only on the collateral-ratio path (hyUSD): if CR falls below the black_swan floor (CR < 100%). It is not reachable from a spread/bps threshold; the spread path's worst state is CRITICAL. Recovery is via the standard decay-down dwell once CR re-enters the band — there is no public ack endpoint." **Delete every `/v1/me/alerts/:id/ack` reference.**
- **overview.mdx:** description → "One formula. Five sources. A bps-threshold FSM (PEGGED → DRIFT → DEPEG → CRITICAL)." Table line replacing the BLACK_SWAN sentence → "BLACK_SWAN is a defined enum state but is reachable today **only** on the collateral-ratio (CR) path used by hyUSD — the spread/bps path tops out at CRITICAL. UNKNOWN is a cold-start/fallback default, not an actively-published verdict."
- **ust-collapse line 29:** "Pegana would have stayed in `DEPEG → CRITICAL` with no recovery transitions — the worst alerting band reachable for a spread-priced asset." **line 44:** "May 9, ~14:00 UTC — Spread blows past 1000+ bps and never recovers. Stays in **`CRITICAL`** indefinitely." **line 45:** "No recovery — the asset never exits `CRITICAL`; sustained terminal stress, operator review required."
- **All `methodology/*` "flips to UNKNOWN" lines:** replace with "skips the recompute and holds the last published state". (Where `honesty.mdx` describes an hourly pinned-IDL check + Sentry alert, label it **not-yet-shipped** — that detector is not in the Rust source.)

### 4c. The stale `21 active` count (true = 26) — fix every occurrence

The Phase-0 activation of JupUSD/JLP/EURC/dzSOL/vSOL on 2026-06-11 raised the active count to **26** (28 entries − BRZ − pbUSDC). The `21` traces to the stale `assets.toml` line-1 header.

| Page / location | Change |
|---|---|
| `introduction.mdx` line 8, 60 | "21 active" → "**26 active**"; "6 classes" → "**7 classes**" |
| `introduction.mdx` "Inactive entries" (72–76) | rewrite — only **BRZ + pbUSDC** are inactive; EURC/JupUSD/JLP/dzSOL/vSOL were activated 2026-06-11; dSOL is **not an entry** (comment-only), removed after Drift |
| `introduction.mdx` Coverage table (63–70) | 7 rows summing to 26 (see below) |
| `methodology/spread.mdx` (38–39), `honesty.mdx` (52–58) | "21 active assets" → "26 active assets" |
| `concepts/peg-risk-101.mdx` (32–34) | "21" → "26"; FX-pegged is **not empty** (EURC active, monitoring_only) |
| `concepts/lst-peg-drift.mdx` (11–14) | 8 LSTs → **10** (add dzSOL, vSOL) |
| `concepts/yield-bearing-nav-oracles.mdx` (3, 11–18) | "five" yield stables → 7 active (add sHYUSD, JLP); note ONyc is monitoring_only |
| `guides/rest-api.mdx` (68) | "(21 rows)" → "(~26 rows)" — prefer soft "(a few dozen rows)" |
| `guides/telegram-bot.mdx` (102) | "21 assets" → "26 assets" |
| `guides/mcp.mdx` (62), `mcp-free-tools.mdx` (55, ~121) | "21"/"22 active" → "26 active assets" |
| `crates/api-rs/src/openapi.rs` (71–94) **[code, requires api-rs rebuild]** | "21 active … 6 classes … 8 LSTs … 5 Phase-0 deferred" → 26/7/10 LSTs/activated |

**Exact Coverage table for `introduction.mdx` (63–70):**
```
| Class        | Active | Examples                                                              |
| lst          | 10     | jitoSOL, mSOL, bSOL, INF, bbSOL, JupSOL, hyloSOL, hyloSOL+, dzSOL, vSOL |
| stable_fiat  | 3      | USDC, USDT, PYUSD                                                      |
| stable_yield | 7      | USDY, sUSDe, sUSD, syrupUSDC, sHYUSD, ONyc, JLP                        |
| stable_cdp   | 2      | USDS, hyUSD                                                            |
| stable_dn    | 2      | USDe, JupUSD                                                           |
| stable_fx    | 1      | EURC                                                                   |
| synth_lev    | 1      | xSOL                                                                   |
```

**Exact "Inactive entries" rewrite (introduction.mdx 72–76):**
> **Inactive entries** (in `assets.toml` with `active = false`, not polled, so not in the 26): `BRZ` (BRL FX-pegged) and `pbUSDC` — deactivated 2026-06-01 (only a thin dust DEX pair left, prices unreliable). Note: `dSOL` is no longer an asset entry — it was removed after the Drift exploit (exploit 2026-04-01, dSOL soft-deactivated 2026-05-26) and survives only as a historical comment. `EURC`, `JupUSD`, `JLP`, `dzSOL` and `vSOL` were activated 2026-06-11 as monitoring-grade Phase-0 assets and are now active. (Not to be confused with `dzSOL` / DoubleZero Staked SOL, a distinct active LST.)

> **API-reference OpenAPI caveat:** when editing `openapi.rs:71-94`, do **not** copy the originally-proposed `8 monitoring-only` clause verbatim — the real monitoring_only set is **13** assets (incl. xSOL, JupUSD, JLP, dzSOL, vSOL), and dropping the "xSOL monitoring-only per ADR-0015" note would regress xSOL. Either list all 13 or omit the clause.

### 4d. MCP tool names — camelCase docs vs snake_case server

**Pages:** `mcp.mdx`, `mcp-free-tools.mdx`, `mcp-paid-tools-x402.mdx`, `mcp-setup-claude.mdx` (≈53 occurrences) — and the live page mirrors them.
**Wrong:** `getAssets`, `getAssetState`, `getMethodology`, `getAssetHistory`, `subscribePegEvents`, `pingPaid`.
**Correct (registered names, `mcp-ts/src/tools/*.ts`):** `get_assets`, `get_asset_state`, `get_methodology`, `get_asset_history`, `subscribe_peg_events`, `ping_paid` (`ping` is already correct). A human or prompt hardcoding the camelCase names cannot invoke the tools.
**Exact mapping:** `getAssets→get_assets`, `getAssetState→get_asset_state`, `getMethodology→get_methodology`, `getAssetHistory→get_asset_history`, `subscribePegEvents→subscribe_peg_events`, `pingPaid→ping_paid`. Sweep all 4 files (don't rely on the partial line list).

### 4e. MCP tool counts — "4 free / 2 paid" is actually 5 free / 3 paid

**Pages:** `mcp.mdx` (3, 29–36, 59–66), `mcp-free-tools.mdx` (2–3), `mcp-paid-tools-x402.mdx` (15–18), `mcp-setup-claude.mdx` (163).
**Correct:** **5 free** (`ping`, `get_assets`, `get_asset_state`, `get_methodology`, **`verify_alert`**) and **3 paid** (`ping_paid` $0.001, `get_asset_history` $0.001, `subscribe_peg_events` $0.0005).
**Exact corrections:** "Four free tools, two paid tools" → "Five free tools, three paid tools"; add `verify_alert` row ("free | Verify an on-chain alert receipt — proxies `GET /v1/audit/:alert_id`, data already public") + a section, retitle free-tools page "Five MCP tools"; add `ping_paid` ($0.001, x402 wiring smoke test) to the paid table; setup card "the 4 free tools" → "the 5 free tools". (Use the doc's camelCase-with-fix convention: `verifyAlert`/`pingPaid` after the 4d sweep.)

### 4f. MCP `subscribePegEvents` doc params/shape are fabricated

**Page:** `docs-site/guides/mcp-paid-tools-x402.mdx` (38–52)
**Wrong:** `{ asset:'jitoSOL', since:'2026-05-25T…' }`; result rows show `alert_id`, `detected_at`, `spread_at_trigger`, `intrinsic_usd`, `market_usd`.
**Correct (`subscribe-peg-events.ts`):** params `symbols` (array 1–20), `since_ts` (unix **seconds**), optional `threshold_bps`. Event shape `{ id, asset, from_state, to_state, discount, ts, evidence_url }`. `spread_at_trigger` exists nowhere in the codebase.
**Exact correction:**
```
// → subscribe_peg_events({ symbols: ["jitoSOL"], since_ts: 0, threshold_bps: 25 })
```
> Result rows: `{ id, asset, from_state, to_state, discount, ts, evidence_url }` where `ts` is unix seconds. `symbols` is a 1–20 element array; `since_ts` is a unix-seconds cursor (pass `next_cursor` on the next call); optional `threshold_bps` filters by `|discount|`.

### 4g. Webhook per-attempt timeout is 5s, not 10s

**Pages:** `docs-site/guides/webhooks.mdx` (103); `docs-site/guides/webhooks-retry-policy.mdx` (8/9, 108).
**Correct:** `webhook.rs:148` sets `.timeout(Duration::from_secs(5))` on every POST; the 10s client default is overridden per-request (verified against reqwest 0.12.24 semantics). A receiver tuned to "10 seconds" that takes 6–9s **silently fails every delivery** into the dead-letter queue.
**Exact correction:** replace all three "10 second(s)/10-second" with **5**: "We expect a response within **5 seconds**…"; "Doesn't return within **5 seconds**"; "Each attempt has a **5-second deadline**…".

### 4h. Hysteresis exit-threshold math (introduction.mdx already covered; concepts/hysteresis-fsm.mdx)

**Page:** `docs-site/concepts/hysteresis-fsm.mdx` (34–45)
**Wrong:** drift exits at 20 bps, depeg exits at 80 bps, "exit threshold is 33–34% closer to neutral".
**Correct:** deadband is **25%** (`DEADBAND_PCT=25`), so exit = entry × 0.75 → drift 30→**22** bps (integer floor of 22.5), depeg 100→**75** bps.
**Exact correction:** "DRIFT → PEGGED exits at 22 bps (30 × 0.75)"; "DEPEG → DRIFT exits at 75 bps (100 × 0.75)"; replace the "33–34% closer" sentence with "The exit threshold sits 25% below the entry threshold (`DEADBAND_PCT = 25%`)." Cleanest: use the canonical code example (enters 60 bps, exits 45 bps).

### 4i. REST `?class=stablecoin` example returns nothing

**Page:** `docs-site/guides/rest-api.mdx` (49) — also the same error in `mcp-free-tools.mdx` (34, 91, USDC `"class":"stablecoin"`).
**Correct:** `class` is a case-sensitive exact match; valid values are `lst, stable_fiat, stable_dn, stable_cdp, stable_yield, stable_fx, synth_lev` (plus the unused-but-valid `stable_rwa`). `stablecoin` silently returns `[]` (HTTP 200).
**Exact correction:** `curl 'https://api.pegana.xyz/v1/assets?class=stable_fiat'`; in `mcp-free-tools.mdx`, USDC's `"class": "stablecoin"` → `"class": "stable_fiat"`.

### 4j. Changelog — 2-week hole missing the launch itself

**Page:** `docs-site/changelog.mdx` — last entry is 2026-05-31; **zero June entries**, despite the page committing to track API contracts, MCP tools, webhook schema, and breaking config. The single most consequential developer-facing event (the 2026-06-11 public launch, which flipped `/v1/alerts`, `/v1/stats.alerts_24h`, `/v1/audit` index/csv from empty→populated) is undocumented.
**Exact correction:** prepend the June entries (verbatim block, newest-first):

```md
## 2026-06-14 — Asset containment + FX-weekend banner
- `hyloSOL+` (migration 0049) and `ONyc` (migration 0050) moved to monitoring_only (contained from public alert/audit/stats egress; still visible in `/v1/assets` with `monitoring_only:true`). The freeze-detector approach was evaluated and Rejected (ADR-0024) — containment, not detection.
- A calm 'FX market closed' StaleBanner variant ships for FX assets (EURC) over the forex weekend (Pyth EUR/USD feed closed Fri ~22:00 → Sun ~22:00 UTC). EURC has been monitoring_only since Phase-0 launch.

## 2026-06-12 — monitoring_only egress gate + JupUSD EWMA guard
- Public ledger feeds (`/v1/alerts`, `/v1/stats.alerts_24h`, `/v1/audit` index, `/v1/audit.csv`) now exclude monitoring_only assets at read time. By-id lookups (`/v1/audit/{id}`, `/onchain`, `/replay-bundle`) stay public and ungated. `/v1/assets` is NOT gated — monitoring_only assets still render with a `monitoring_only` boolean.
- Engine plausibility guard tightened from `|discount| <= 1.0` to `|discount| < 1.0` after a $0 Jupiter quote poisoned the EWMA and painted JupUSD CRITICAL for ~7.5 min.

## 2026-06-11 — Public launch (FEATURE_PUBLIC_ALERTS)
- The public alert ledger is now live. `/v1/alerts`, `/v1/stats.alerts_24h`, and the `/v1/audit` index/csv now return real data (previously gated empty by ADR-0020's `feature_public_alerts=false`). 5 Phase-0 assets (JupUSD, JLP, EURC, dzSOL, vSOL) activated monitoring-grade.

## 2026-06-10 — API JSON-error hardening (Gecko report)
- Added `GET /health` alias for `/healthz`; every error path now returns an application/json `{error, message}` envelope (incl. 404, 429 with `Retry-After`, malformed-body `invalid_body`); deduplicated operationIds; PegState/Confidence documented as enums.

## 2026-06-09 — Webhook channel types
- Webhooks now auto-detect channel by host: Discord (embed, unsigned), Slack (attachment, unsigned), Generic (Ed25519-signed). Migration 0046. 429 `Retry-After` honored.

## 2026-06-04 — Methodology 0.3.0 (CR-side deadband)
- ADR-0023: added a magnitude deadband on the hyUSD CR path (`CR_DEADBAND_PCT=2`), cutting CR band-flapping ~52→~10 transitions/2d. Migration 0044.

## 2026-06-03 — Bot is English-only
- ADR-0022: removed pt-BR localization and the `/lang` command; the bot is now English-only.

## 2026-06-01 — Methodology 0.2.0 (deadband + LST premium carve-out)
- ADR-0021: bps-path magnitude deadband (`DEADBAND_PCT=25`) and LST/stable_yield premium carve-out (a premium is forced to PEGGED). Migration 0041.
```

### 4k. Methodology `intrinsic-value.mdx` — "we track no EUR asset" is false

**Page:** `docs-site/methodology/intrinsic-value.mdx` "FX-pegged assets" (77–83)
**Correct:** EURC is active (`assets.toml:603`, `stable_fx`, `peg_target=EUR`), monitoring_only, dark on the forex weekend.
**Exact correction:** "We track EURC (Circle Euro Coin), the live EUR-pegged asset: its intrinsic redeems at `pyth.EUR/USD` per token. EURC is monitoring_only and dark on the forex weekend (the Pyth EUR/USD feed is closed Fri ~22:00 → Sun ~22:00 UTC) — that staleness is expected, not an outage."

### 4l. Live OpenAPI `info.description` is stale (requires api-rs rebuild)

**Page:** `crates/api-rs/src/openapi.rs` (71–94) — rendered on the API Reference tab. Says 21 active / 6 classes / 8 LSTs / 5 Phase-0 "deferred". Fix to 26/7/10-LSTs/activated per §4c, **then rebuild + redeploy api-rs** so the live spec refreshes. (See the monitoring_only caveat above.)

---

## 5. P2 / P3 — polish

Lower-severity items the verification pass either confirmed at P2/P3 or left as `not-verified(low-sev)`. Batch these after the P0/P1 pass.

**Counts & lists (P2/P3):**
- `pricing.mdx` free-reads cell under-lists public endpoints → add `/v1/calibration`, `/v1/methodology/current`, `/v1/audit*`, `/v1/meta/*`.
- `faq.mdx` "5 fiat stables" → 3 (USDC/USDT/PYUSD) + EURC; `honesty.mdx` "active 22" → 26.
- `methodology/intrinsic-value.mdx` "Fiat stables" group wrongly lumps USDS (stable_cdp) and USDe (stable_dn) under issuer-contract=$1 — split them out.
- `concepts/yield-bearing-nav-oracles.mdx` & `methodology/intrinsic-value.mdx` cite pbUSDC as "in active integration" — it was deactivated 2026-06-01 (dust pool); drop or mark deactivated. USD* removed 2026-05-22.
- `methodology/spread.mdx` class threshold table — add a "representative bands; live per-asset values vary (jitoSOL 0.45/1.10/2.50%, xSOL 15/30/60%)" caveat; add missing stable_dn/stable_fx rows.

**Endpoints / config (P2/P3):**
- Rate-limit "300 req/min" (faq, pricing, auth, rest-api, api-reference, openapi) — repo default is **60/min**; 300 is a prod host override. Soften to "~300 in production (repo default 60/min); handle 429 and back off." Add the stricter **10/min on `/v1/audit.csv`**.
- `methodology/overview.mdx` & `spread.mdx` — `/v1/assets/:symbol/extra` is not a route; use `/v1/assets/:symbol`. Engine constants live in `main.rs`, not `config.rs` (fix the GitHub link).
- `authentication.mdx` — "only way to get a JWT is Telegram Login" → also the magic-link flow (`/v1/auth/magic/mint`→`consume`); add missing webhook routes (`PATCH`, `/test`, `/replay`, `/deliveries`).
- `guides/telegram-bot.mdx` commands table lists 14 → add `/menu`, `/alerts`, `/define`, `/me` (18 total). Self-hosted line: Fluent is dormant/EN-only (ADR-0022).
- `guides/embed-widget.mdx` — `Cache-Control` is `s-maxage=60, stale-while-revalidate=300` (not `max-age=60`); badge is 320×56 when `sparkline=off`. Remove `User-Agent: Pegana/0.1.0` from the webhook header sample (`webhooks.mdx:79`) — not sent.
- `webhooks-signing.mdx` — "we sign **every** delivery with Ed25519" → only **Generic**; Discord/Slack are intentionally unsigned. Add a "Channel types" note.
- `mcp.mdx` self-hosting — server boots on **:8090** (not :3000); align command to `bun start`/`bun dev`. `mcp-paid-tools-x402.mdx` on-chain receipts — drop the `7da9158`/C4 framing (that commit reverted prod to devnet for dogfood); cite ADR-0018 (3 early mainnet settlements ~2026-05-27 + 1 confirmed 2026-05-31, self-issued dogfood). CDP env-var names (`X402_WALLET_PROVIDER`/`CDP_API_KEY_NAME`/…) — reconcile against the server's `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET`. Verify `mcp.pegana.xyz/health` actually serves `ok` (or use the `ping` tool).
- `changelog.mdx` — `git_tag` → `methodology_git_sha`; OpenAPI "32 path-items" → **35**; move the dSOL "scheduled before launch" clause to past tense; annotate the 60→300 rate-limit entry as a prod override.
- `docs.json` — nav integrity verified clean (0 dead links, 0 missing pages); no edit needed.

**Live-site polish (web deploy, not docs-site):**
- Home page banner "public delivery opens … June 11, 2026" (already in §4a).
- `/status` SSR pre-hydration shell renders a hard-coded "Investigating an outage" to non-JS clients/crawlers; SSR real data or a neutral loading state instead.

---

## 6. Codebase & live-service validation

| Check | Result | Detail |
|---|---|---|
| **Rust workspace** | 🟢 pass (partial scope) | `cargo fmt --all --check` clean; `cargo clippy --workspace --all-targets` 0 warnings; `pegana-common` 23/23 + `pegana-methodology` 48/48 = 71/71. Toolchain cargo 1.90.0. |
| **Web app** | 🟢 pass | `bun run typecheck` (tsc) clean; `bun run lint` (eslint) clean; `bun run test` (vitest) **266/266** across 46 files. Repo uses **bun**, not pnpm. |
| **Live API** | 🟡 partial | `/health` 200, `/readyz` 200 (db+redis+sources fresh, last snapshot 2s). `/v1/assets` returns **26** (stats `assets_tracked=26`), all PEGGED, 13 monitoring_only. OpenAPI 35 paths, `info.version` 0.1.0. Methodology `0.3.0`. `webhook-keys` present. |
| **Live web** | 🟡 partial | pegana.xyz → www (307). Home/`/assets`/`/status`/`/asset/usdc`/`/docs` all 200 after hydration; screener reads "26 assets tracked live"; `/docs` is Mintlify on Vercel. |

**Skipped (and why):**
- **DB/Docker-backed integration tests** (`api-rs`/`engine-rs`/`indexer-rs`/`dispatcher-rs`, gated on `PEGANA_E2E_STACK`) — Docker is down and the env var is unset; correctly skipped per workspace convention. Those suites are **unverified** here.
- **`5-state FSM` could not be confirmed from the live snapshot** — all 26 assets are PEGGED in this calm window; the state-enum count is only confirmable from the OpenAPI enum or a non-calm window. (Code review confirms 6 enum variants, 4 reachable on the bps path.)

**Live-vs-docs mismatches surfaced by probing** (all feed the findings above): `21 active` → **26**; documented `/ready` 404s (it's `/readyz`); no `X-RateLimit`/`Retry-After` headers exposed (a 25-request burst all returned 200 — the soft limit is not client-discoverable); there is **no `active`/`is_active` field** in the asset payload, so the documented "active subset" cannot be expressed via the API (`monitoring_only` is the operative live distinction, true on 13 of 26).

---

## 7. Recommended fix plan

Batched so the maintainer can land low-risk, high-value changes first. Almost everything is **docs-site MDX (Mintlify) → requires a docs-site redeploy** to go live; two batches touch code/web.

### Batch A — Trust-critical doc fixes (docs-site redeploy) — DO FIRST
The claims that are actively misleading about engine safety.
- [ ] `docs-site/faq.mdx` — P0-1 (UNKNOWN-on-outage)
- [ ] `docs-site/concepts/state-machine.mdx` — P0-2 (UNKNOWN as live state) + exit-dwell 60s→120s
- [ ] `docs-site/concepts/hylo-cdp-cr-signal.mdx` — P0-3 (CR band table) + IDL-drift UNKNOWN/Sentry line
- [ ] `docs-site/methodology/{honesty,market-value,intrinsic-value,spread}.mdx` — every "flips to UNKNOWN" → "skips recompute, holds last state"; spread.mdx delete `/v1/me/alerts/:id/ack`
- [ ] `docs-site/methodology/overview.mdx` + `concepts/hysteresis-fsm.mdx` + `concepts/confidence-score.mdx` — BLACK_SWAN CR-only, UNKNOWN cold-start, exit dwell 120s
- [ ] `docs-site/case-studies/ust-collapse-may-2022.mdx` — CRITICAL not BLACK_SWAN

### Batch B — Launch-state banners (docs-site redeploy + 1 web deploy)
- [ ] `docs-site/faq.mdx`, `guides/telegram-bot.mdx`, `guides/webhooks.mdx` — delete/replace calibration `<Note>` blocks (§4a)
- [ ] **[web deploy]** home page "public delivery opens … June 11, 2026" copy

### Batch C — MCP integration accuracy (docs-site redeploy) — high developer impact
- [ ] Sweep `mcp.mdx`, `mcp-free-tools.mdx`, `mcp-paid-tools-x402.mdx`, `mcp-setup-claude.mdx`: camelCase→snake_case tool names (§4d), 5-free/3-paid counts + `verify_alert`/`ping_paid` (§4e), `get_asset_history` params (P0-4), `subscribe_peg_events` params/shape (§4f)

### Batch D — The "21 → 26" sweep (docs-site redeploy)
- [ ] `introduction.mdx` (count, classes, Coverage table, Inactive-entries rewrite), `methodology/spread.mdx`, `methodology/honesty.mdx`, `methodology/intrinsic-value.mdx` (EURC), `concepts/{peg-risk-101,lst-peg-drift,yield-bearing-nav-oracles}.mdx`, `guides/{rest-api,telegram-bot}.mdx`, `guides/mcp.mdx`, `mcp-free-tools.mdx` (§4c, §4k)

### Batch E — Other P1 doc fixes (docs-site redeploy)
- [ ] `guides/webhooks.mdx` + `webhooks-retry-policy.mdx` — 10s→5s timeout (§4g)
- [ ] `concepts/hysteresis-fsm.mdx` — 25% deadband math (§4h)
- [ ] `guides/rest-api.mdx` + `mcp-free-tools.mdx` — `?class=stablecoin`→`stable_fiat` (§4i)
- [ ] `changelog.mdx` — prepend the June block (§4j)

### Batch F — Code/spec changes (require rebuild/redeploy, NOT docs-site)
- [ ] **[api-rs rebuild + redeploy]** `crates/api-rs/src/openapi.rs:71-94` — 26/7/10-LSTs/activated; use the corrected 13-asset monitoring_only set or omit the clause (§4l)
- [ ] **[web deploy]** `/status` SSR pre-hydration shell — replace hard-coded "outage" with real data or a neutral loading state

### Batch G — P2/P3 polish (docs-site redeploy)
- [ ] All §5 items, batched per page.

---

**Deploy reminders:**
- All `docs-site/*.mdx` and `docs-site/docs.json` edits go live via the **Mintlify/docs-site redeploy** (the `/docs` tab on `pegana.xyz`, served through Vercel).
- The OpenAPI `info.description` (Batch F) is **not** a docs-site edit — it is baked into `api-rs` and only refreshes on an **api-rs rebuild + redeploy**. Per project convention, **never recreate `engine`/`indexer` mid-stability-lock**; an `api-rs`-only deploy is calibration-safe.
- Home page and `/status` copy are **web app deploys** (Vercel on push to `main`), separate from both docs-site and api-rs.
