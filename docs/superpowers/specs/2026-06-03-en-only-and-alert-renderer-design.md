# Design — EN-only bot + alert-renderer redesign (hyUSD/CDP)

**Date**: 2026-06-03
**Status**: Approved design (grill-resolved), pending implementation plan
**Scope**: Two sequenced workstreams. WS3 (threshold → min-state) and the noted backlog are explicitly **out of scope** here.

---

## 0. Origin & problem

The founder disliked the live hyUSD alert line `Razão de Colateral: 130.0% (piso 100% · +30pp)`. Investigation reframed it: the defect is **structural**, not wording.

- **hyUSD is the only CR-driven asset** (`crates/engine-rs/src/main.rs:630-658`: `state_for_cr` is gated on `asset == "hyUSD"`). Its state changes because the **collateral ratio** crosses a band (`assets.toml:218` → `drift=130, depeg=115, critical=105, black_swan=100`), not because of the market spread.
- The shared `alert_cdp` template renders a **spread-first body** (correct for spread-driven assets) and bolts CR on as an italic footnote. So the hyUSD alert **leads with `Spread −0.272%` (which reads "basically pegged")** and buries the real trigger (CR at the drift band). That is an information-architecture inversion.
- The `(floor 100% · +30pp)` parenthetical is **redundant** (floor is exactly 100, so `+30pp = 130 − 100`) and anchored to the **far floor** when the next actual escalation, DEPEG, is at **115% — only 15pp away**.

A second, separate decision was taken in the same session: **remove pt-BR; the bot becomes EN-only.** Web/API/MCP are already EN-only (ADR-0012) and have **no PT strings** (web only uses `toLocaleString("en")`). The bot already *defaults* to EN (`index.ts:234`, "PT-BR is one /lang pt away"). So this footprint is **bot-ts + one migration + docs + an ADR amendment**.

Because the alert body is rendered from `COPY_EN`/`COPY_PT` in `bot-ts/src/helpers.ts`, collapsing to a single copy object **must happen before** rewriting the alert — otherwise the alert is rewritten twice and half is discarded. Hence the sequence WS1 → WS2.

---

## WS1 — Remove pt-BR (EN-only bot)

### Goal
Bot serves English only. Keep the Fluent i18n machinery **dormant** with a single `en.ftl`, so ADR-0012's Phase-16 expansion (Korean/Chinese/Japanese/Spanish) stays a cheap re-add rather than a rebuild.

### Changes
1. **Delete** `bot-ts/locales/pt-BR.ftl` (662 lines).
2. **`bot-ts/locales/en.ftl`** — remove language-management strings: `lang_usage`, `lang_set`, the `<code>/lang pt|en</code>` line in `help`, the `Idioma` section, the per-ADR-0012 bilingual disclaimer, and the language line/row in `settings_panel`/menu. **Fix the stale `/help` line**: "Monitorando 22 assets … 7 yield-bearing (… pbUSDC)" → **21 assets / 6 yield-bearing**, drop `pbUSDC` (deactivated 2026-06-01).
3. **`bot-ts/src/helpers.ts`** — collapse to a single locale:
   - Remove `COPY_PT` and `CLASS_LABELS_PT`.
   - `copyFor(locale)` → return the single EN copy unconditionally (or inline it).
   - `prettyClass(klass, locale)` → drop the locale branch; EN labels only.
4. **`bot-ts/src/index.ts`** — remove the language UX:
   - `/lang` command (~866-876) and its `lang_usage`/`lang_set` replies.
   - `set:lang:toggle` callback (~573-579) **and its button** in the Preferências/settings keyboard.
   - `COMMANDS_PT` and the `setMyCommands(…, { language_code: "pt" })` call (~1330, ~1353-1354); keep only `COMMANDS_EN`.
   - Simplify `localeNegotiator` (~180-192) to always resolve `"en"`; drop the session/DB locale read.
   - Narrow the `locale?: "pt-BR" | "en"` type to `"en"` (or remove the field where it becomes trivial).
5. **`bot-ts/src/db.ts`** — `setLocale` becomes dead → remove its call sites; **keep the `users.locale` column** (dropping it is a heavier migration; leaving it defaulted to `'en'` is cheap and reversible). `getLocale`/session-locale read paths simplify or no-op.
6. **Migration** `migrations/0043_locale_default_en.sql` (highest existing is `0042_resync_asset_thresholds.sql`):
   ```sql
   ALTER TABLE users ALTER COLUMN locale SET DEFAULT 'en';
   UPDATE users SET locale = 'en' WHERE locale IN ('pt-BR', 'pt');
   ```
   This also closes the **pre-existing mismatch** (DB default `'pt-BR'` at `migrations/0001_initial.sql:133` vs the EN negotiator).
7. **Docs** — `docs-site/guides/telegram-bot.mdx`, `quickstart.mdx`, `pricing.mdx`: drop "PT-BR + EN" bot claims → EN-only.
8. **ADR** — add **ADR-0022 "Bot EN-only (supersedes ADR-0012 §bot scope)"** + an `AMENDMENTS.md` entry per project convention. Keep ADR-0012's Phase-16 backlog intact (machinery stays dormant).

### Vestigial-but-harmless (no change now)
The dispatcher still passes `locale` into the bot `/send` payload; with every user `'en'` it renders EN. Noted, not touched.

### Tests
- Update `bot-ts/test/helpers.test.ts` and `session-storage.test.ts` to drop pt-BR assertions; assert `prettyClass`/copy resolve EN regardless of input.

---

## WS2 — Alert-renderer redesign

**Key architectural simplification:** both new data points ride in the engine's `extra` JSON (already emitted and already read by the bot as `vars.extra` — it's where `cr`/`cr_floor` come from today). **No change to the `AlertEvent` struct, the Redis wire, or the dispatcher.** WS2 = *engine adds fields to `extra`* + *bot rewrites the renderer*.

### 2a. Engine — additive `extra` fields (`crates/engine-rs/src/main.rs`, alert-build block ~863-874)
- `confidence`: the already-computed `confidence_label` (`pyth_confidence_for_asset`, ~line 697) — stamp `"confidence": confidence_label.to_string()` for **every** alert.
- For **CR-driven assets only** (i.e. when `thresholds_cr` exists / `cr_floor` is non-null): compute the **next-worse band** below the current state from the `thresholds_cr` map and add:
  - `cr_next_band`: e.g. `"DEPEG"` (the next state down from the current band), or omit if already at the worst band (`black_swan`).
  - `cr_next_at`: that band's CR threshold (e.g. `115`).
  - A small pure helper (engine or methodology crate) `next_worse_cr_band(current_state, thresholds_cr) -> Option<(PegState, u32)>`, unit-tested.

### 2b. Bot — `renderAlertTemplate` (`bot-ts/src/helpers.ts`)
Branch on **`extra.cr_floor != null`** (the per-asset CR-driven flag), **not** on template name. This is also the **USDS leak fix** — today the block is guarded by `if (extra.cr)`, and `extra.cr` is the *global* hyUSD CR (`main.rs` sets `"cr": engine.hyusd_cr()` for every asset), so a USDS alert would render hyUSD's CR. `cr_floor` is correctly per-asset (only hyUSD has `thresholds_cr`).

- **CR-driven body (hyUSD)** — CR leads, spread demoted:
  ```
  State: PEGGED → DRIFT
  Collateral Ratio: 130.0% — entered DRIFT band
    next: DEPEG at 115% (15pp away)

  Market $1.0027 vs intrinsic $1.0000 (spread −0.27%)
  ```
  - `Npp away` = `round(cr*100 − cr_next_at)`.
  - Omit the `next:` line when `cr_next_band` is absent (already at worst band).
- **Spread-driven body (USDS and all non-CR assets)** — **unchanged** existing layout (State / Spread+tag / Intrinsic / Market). No CR line. Leak gone.
- **Oracle-confidence line (all templates):** when `extra.confidence` present and `!= "high"`, append before the Evidence line:
  ```
  ⚠️ Oracle confidence: LOW — Pyth spread wide; may be noise
  ```
  When `high` (or absent), render nothing.
- **Spread clarity (P1-a):** no separate work — non-CDP templates already carry the direction tag (`premium · …` / `discount · …` / `normalized · …`, helpers.ts:330-336). On the CR-driven body the spread is an intentionally minimal secondary line.

### Final rendered states (target)
**hyUSD, normal confidence:**
```
🚨 hyUSD · DRIFT · CDP Stable

State: PEGGED → DRIFT
Collateral Ratio: 130.0% — entered DRIFT band
  next: DEPEG at 115% (15pp away)

Market $1.0027 vs intrinsic $1.0000 (spread −0.27%)

🔍 Evidence (audit 39334a76)
```
**hyUSD, degraded confidence** — adds the `⚠️ Oracle confidence` line above Evidence.
**USDS (spread-driven CDP):**
```
🚨 USDS · DRIFT · CDP Stable

State: PEGGED → DRIFT
Spread: 0.21% (discount · market below intrinsic)
Intrinsic: $1.0000
Market:    $0.9979

🔍 Evidence (audit ab12cd34)
```

### Tests (TDD — `bot-ts/test/helpers.test.ts` + engine unit tests)
- CR-driven body leads with CR + correct `Npp away`; `next:` omitted at worst band.
- `extra.cr_floor` absent (USDS) ⇒ **no CR line**, spread-first body intact (regression test for the leak).
- Confidence line present iff `confidence` present and `!= "high"`.
- Engine `next_worse_cr_band` table tests across all bands incl. boundaries and worst-band.

---

## Sequencing, risk, rollout
1. **WS1** first (mechanical, low risk) → single `en.ftl` + collapsed copy.
2. **WS2** on top (engine `extra` + bot renderer, TDD).
- No dispatcher/wire/struct changes in either WS → low blast radius.
- Migration is additive/idempotent.
- Deploy: bot via its normal path; engine change via `scripts/deploy.sh` (staging on prod-local first per the validation ladder).

## Explicitly out of scope
- **WS3** — `/threshold` (`threshold_bps`) is stored/displayed but **never enforced for Telegram** (only webhooks: `dispatcher-rs/webhook_queries.rs:40`). Recommended future direction: replace with a **minimum-severity-state** filter enforced in the dispatcher match query. Tracked separately; current Telegram behavior is band-only.
- **Backlog** — suppressed-recovery "all-clear" message; richer daily digest; xSOL severity-scale wording (bands 10–40× wider than stables).
- **Ops side-items** (flagged, not part of this effort): `pegana-watch-daily` cron failing since 2026-05-30 (Sentry); R2-lifecycle note correction ("pending" → active).
