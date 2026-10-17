# EN-only bot + hyUSD/CDP alert-renderer redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Telegram bot English-only (Fluent kept dormant) and redesign the alert so CR-driven assets (hyUSD) lead with the collateral ratio + next-band distance, surface degraded oracle confidence, and stop leaking hyUSD's CR into USDS alerts.

**Architecture:** Two sequenced workstreams on branch `en-only-alert-renderer`. WS1 collapses the bot to a single `en.ftl`/copy object (so WS2 rewrites the alert once). WS2 adds additive fields to the engine's alert `extra` JSON and rewrites the bot renderer — **no dispatcher / Redis-wire / struct changes**.

**Tech Stack:** TypeScript (Bun, grammY, Fluent i18n) for the bot; Rust for engine + methodology crate; Postgres migrations.

**Spec:** `docs/superpowers/specs/2026-06-03-en-only-and-alert-renderer-design.md`

**Commit convention:** every commit message ends with the trailer
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
(omitted from the per-step examples below for brevity — add it).

---

## WS1 — Remove pt-BR (EN-only bot)

### Task 1: Collapse the alert copy to a single locale (`helpers.ts`)

**Files:**
- Modify: `bot-ts/src/helpers.ts` (remove `COPY_PT` ~206-240, `CLASS_LABELS_PT` ~268-277; simplify `copyFor` ~242-243 and `prettyClass` ~279-287)
- Test: `bot-ts/test/helpers.test.ts`

- [ ] **Step 1: Write the failing test** — append to `bot-ts/test/helpers.test.ts`. NOTE: `prettyClass`, `describe`, `it`, `expect` are ALREADY imported at the top of that file (verified) — do NOT add an import line. There is already a `describe("prettyClass", …)` covering EN labels; append this NEW block for the pt→EN behavior:

```ts
describe("prettyClass — EN-only (pt locale is ignored)", () => {
  it("returns the English label even when a pt locale is requested", () => {
    expect(prettyClass("stable_cdp", "pt-BR")).toBe("CDP Stable");
    expect(prettyClass("stable_cdp", "pt")).toBe("CDP Stable");
    expect(prettyClass("lst", "en")).toBe("Liquid Staking Token");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (currently `prettyClass("stable_cdp","pt-BR")` returns the pt label `"Stable CDP"`):

Run: `cd bot-ts && bun test test/helpers.test.ts`
Expected: FAIL — received `"Stable CDP"`, expected `"CDP Stable"`.

- [ ] **Step 3: Delete `COPY_PT`** — remove the entire `const COPY_PT: AlertCopy = { ... };` block (lines ~206-240). Update the `AlertCopy` doc comment (line ~123) from `EN is canonical; pt-BR lives here` to `English-only (bot is EN-only as of ADR-0022); kept as a typed object, not a Fluent bundle, so the renderer stays a pure function.`

- [ ] **Step 4: Simplify `copyFor`** — replace lines ~242-244:

```ts
function copyFor(_locale: string): AlertCopy {
  return COPY_EN;
}
```

- [ ] **Step 5: Delete `CLASS_LABELS_PT`** (lines ~268-277) and simplify `prettyClass` (lines ~279-287):

```ts
export function prettyClass(klass: string, _locale: string): string {
  const hit = CLASS_LABELS_EN[klass.toLowerCase()];
  if (hit) return hit;
  return klass
    .split("_")
    .map((p) => (p.length ? p[0]!.toUpperCase() + p.slice(1) : p))
    .join(" ");
}
```

- [ ] **Step 6: Run tests + typecheck — expect PASS**

Run: `cd bot-ts && bun test test/helpers.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add bot-ts/src/helpers.ts bot-ts/test/helpers.test.ts
git commit -m "refactor(bot): collapse alert copy to EN-only (drop COPY_PT/CLASS_LABELS_PT)"
```

---

### Task 2: Remove the language UX from `index.ts`

**Files:**
- Modify: `bot-ts/src/index.ts`

- [ ] **Step 1: Narrow the session type** (line ~108):

```ts
interface SessionData {
  locale?: "en";
}
```

- [ ] **Step 2: Simplify the locale negotiator** — replace the `localeNegotiator` (lines ~187-197) with:

```ts
  localeNegotiator: () => "en",
```
(Bot is EN-only; no DB read, no session seeding. `defaultLocale: "en"` already set.)

- [ ] **Step 3: Remove the settings-panel language button** — in `renderSection` (the `"settings"` case, lines ~409-426), delete the `const locale = …` line (~409), remove `locale,` from the `ctx.t("settings_panel", { … })` vars (~413), and delete the language button row (~420-424). The keyboard becomes:

```ts
      const text = ctx.t("settings_panel", {
        alerts: alertsOn ? ctx.t("on") : ctx.t("off"),
        digest: digestOn ? ctx.t("on") : ctx.t("off"),
      });
      const kb = new InlineKeyboard()
        .text(
          alertsOn ? ctx.t("settings_alerts_toggle_off") : ctx.t("settings_alerts_toggle_on"),
          "set:alerts:toggle",
        )
        .row()
        .text(ctx.t("menu_back"), "menu:main");
      return { text, kb };
```

- [ ] **Step 4: Delete the `set:lang:toggle` callback** — remove the entire `bot.callbackQuery(/^set:lang:toggle$/, async (ctx) => { … });` block (lines ~573-586).

- [ ] **Step 5: Delete the `/lang` command** — remove the entire `bot.command("lang", withCmd("lang", async (ctx) => { … }));` block (lines ~866-877).

- [ ] **Step 6: Change the `/send` payload locale default** — find the Zod field `locale: z.string().default("pt-BR")` (line ~1112) and change it to:

```ts
      locale: z.string().default("en"),
```

- [ ] **Step 7: Drop the per-pt command menu** — delete `COMMANDS_PT` (lines ~1312-1332), remove the `{ command: "lang", … }` entry from `COMMANDS_EN` (line ~1308), and in `registerCommands` drop the `pt` payload key (~1338) and the pt `setMyCommands` call (~1354). The result:

```ts
async function registerCommands(): Promise<void> {
  const payload = {
    default: COMMANDS_EN,
    en: COMMANDS_EN,
    menu: { type: "commands" },
  };
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const cached = await db.getRuntimeValue<{ hash?: string; retry_after_until?: string }>("telegram_menu_payload");
  if (cached?.retry_after_until && Date.now() < new Date(cached.retry_after_until).getTime()) {
    log.warn({ retry_after_until: cached.retry_after_until }, "telegram menu registration rate-limited; skipping");
    return;
  }
  if (cached?.hash === hash) {
    log.info({ hash }, "telegram menu unchanged; skipping registration");
    return;
  }
  const results = await Promise.allSettled([
    bot.api.setMyCommands(COMMANDS_EN),
    bot.api.setMyCommands(COMMANDS_EN, { language_code: "en" }),
    bot.api.setChatMenuButton({ menu_button: { type: "commands" } }),
  ]);
```

- [ ] **Step 8: Typecheck — expect PASS** (this surfaces any dangling reference to removed symbols):

Run: `cd bot-ts && bun run typecheck`
Expected: PASS. If it flags `ctx.session.locale` assignments you missed, remove them.

- [ ] **Step 9: Commit**

```bash
git add bot-ts/src/index.ts
git commit -m "feat(bot): remove /lang + language toggle + pt command menu (EN-only)"
```

---

### Task 3: Remove dead locale DB helpers (`db.ts`)

**Files:**
- Modify: `bot-ts/src/db.ts` (delete `setLocale` ~67-69 and `getLocale` ~71-76)

- [ ] **Step 1: Confirm no remaining callers**

Run: `cd bot-ts && grep -rn "db.setLocale\|db.getLocale\|setLocale\|getLocale" src/`
Expected: only the definitions in `db.ts` (callers were removed in Tasks 1-2). If any caller remains, remove it first.

- [ ] **Step 2: Delete `setLocale` and `getLocale`** (lines ~67-76). Keep `upsertUser` and the `users.locale` column untouched (it stays, defaulted to `'en'`).

- [ ] **Step 3: Typecheck — expect PASS**

Run: `cd bot-ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add bot-ts/src/db.ts
git commit -m "refactor(bot): drop dead setLocale/getLocale helpers"
```

---

### Task 4: Strip language strings + fix stale count in `en.ftl`; delete `pt-BR.ftl`

**Files:**
- Delete: `bot-ts/locales/pt-BR.ftl`
- Modify: `bot-ts/locales/en.ftl`

- [ ] **Step 1: Delete the pt-BR bundle**

```bash
git rm bot-ts/locales/pt-BR.ftl
```

- [ ] **Step 2: Edit `help`** — remove the `Language` block (lines 48-49):

```
    <b>Language</b>
    <code>/lang pt|en</code> — switch language
```
and fix the tracked-assets footer (line 56) — `pbUSDC` is deactivated, so 21 assets / 6 yield-bearing:

```
    📊 Tracking 21 assets: 3 fiat (USDC USDT PYUSD) · 2 CDP (USDS hyUSD) · 1 delta-neutral (USDe) · 8 LSTs · 6 yield-bearing (USDY sUSD syrupUSDC sUSDe ONyc sHYUSD) · 1 leveraged (xSOL)
```

- [ ] **Step 3: Delete `lang_usage`** (lines 88-90) and **`lang_set`** (line 153, plus its `# ---------- language ----------` comment on 151).

- [ ] **Step 4: Remove the Language line from `me_card`** (line 225 `<b>Language:</b> { $locale }`).

- [ ] **Step 5: Remove the Language line from `settings_panel`** (line 657 `<b>Language:</b> { $locale }`) and drop the `/lang` clause on line 659 so it reads:

```
    Toggle alerts to stop every notification at once. Use <code>/digest on|off [hour] [TZ]</code> for the daily summary.
```

- [ ] **Step 6: Verify no code references a removed key**

Run: `cd bot-ts && grep -rn "lang_usage\|lang_set\|\$locale" src/ && echo "FOUND-REFS" || echo "clean"`
Expected: `clean` (no remaining references). `me_card`/`settings_panel` no longer pass `locale`, set in Tasks 2.

- [ ] **Step 7: Run the full bot test suite + typecheck — expect PASS**

Run: `cd bot-ts && bun test && bun run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add bot-ts/locales/en.ftl
git commit -m "feat(bot): drop pt-BR bundle + language strings; fix stale 22->21 asset count"
```

---

### Task 5: Migration — flip `users.locale` default to `en`

**Files:**
- Create: `migrations/0043_locale_default_en.sql`

- [ ] **Step 1: Create the migration**

```sql
-- 0043_locale_default_en.sql
-- Bot is EN-only (ADR-0022, supersedes ADR-0012 bot scope). The original
-- default was 'pt-BR' (0001_initial.sql:133) while the bot already negotiated
-- to 'en' — this closes that mismatch and migrates existing pt rows.
ALTER TABLE users ALTER COLUMN locale SET DEFAULT 'en';
UPDATE users SET locale = 'en' WHERE locale IN ('pt-BR', 'pt');
```

- [ ] **Step 2: Apply against the local dev DB and verify**

Run (prod-local stack on :5434 per project dev workflow — adjust DSN if needed):
`psql "$PEGANA_DATABASE_URL" -f migrations/0043_locale_default_en.sql`
Then: `psql "$PEGANA_DATABASE_URL" -c "SELECT DISTINCT locale FROM users;"`
Expected: only `en` (and the column default is now `en`).

- [ ] **Step 3: Commit**

```bash
git add migrations/0043_locale_default_en.sql
git commit -m "feat(db): migration 0043 — users.locale default en + migrate pt rows"
```

---

### Task 6: Docs + ADR-0022

**Files:**
- Modify: `docs-site/guides/telegram-bot.mdx`, `docs-site/quickstart.mdx`, `docs-site/pricing.mdx`
- Create: `docs/adr/0022-bot-en-only.md`
- Modify: `docs/adr/AMENDMENTS.md` (if present — append an entry)

- [ ] **Step 1: Update docs-site** — in each of the three `.mdx` files, find any "PT-BR + EN" / "Portuguese" bot-language claim and change it to English-only.

Run to locate: `grep -rni "pt-br\|portuguese\|/lang" docs-site/guides/telegram-bot.mdx docs-site/quickstart.mdx docs-site/pricing.mdx`
Edit each hit so the bot is described as English-only; remove `/lang` mentions.

- [ ] **Step 2: Create ADR-0022**

```markdown
# ADR 0022 — Bot is English-only (supersedes ADR-0012 §bot scope)

**Status**: Accepted (2026-06-03)
**Supersedes**: ADR-0012 clause "PT-BR + EN bot"

## Decision
The Telegram bot is English-only. The Fluent i18n machinery is kept dormant
with a single `en.ftl`, so ADR-0012's Phase-16 expansion (Korean, Chinese,
Japanese, Spanish) remains a cheap re-add, not a rebuild. Web/API/MCP were
already English-only (ADR-0012) and unaffected.

## Context
The bot already defaulted to English (`index.ts` getUserOrCreate) with pt-BR
as an opt-in `/lang pt`; the DB default was still `'pt-BR'` (a mismatch).
During private calibration, maintaining a second locale was unjustified cost.

## Consequences
- Removed: `pt-BR.ftl`, `COPY_PT`/`CLASS_LABELS_PT`, `/lang`, the settings
  language toggle, the pt command menu. Migration 0042 flips the DB default.
- ADR-0012's Phase-16 backlog stays valid; re-adding a locale = new `.ftl` +
  re-enable a language switch.
```

- [ ] **Step 3: AMENDMENTS.md** — if `docs/adr/AMENDMENTS.md` exists, append: `- ADR-0012 §bot scope superseded by ADR-0022 (bot EN-only), 2026-06-03.`

- [ ] **Step 4: Commit**

```bash
git add docs-site/guides/telegram-bot.mdx docs-site/quickstart.mdx docs-site/pricing.mdx docs/adr/0022-bot-en-only.md docs/adr/AMENDMENTS.md
git commit -m "docs: bot EN-only — ADR-0022 supersedes ADR-0012 bot scope; update docs-site"
```

---

## WS2 — Alert-renderer redesign

### Task 7: Methodology helper `next_worse_cr_band` (Rust, TDD)

**Files:**
- Modify: `crates/methodology/src/thresholds.rs` (add function after `state_for_cr`, ~line 171; add tests in the existing `mod tests`)

- [ ] **Step 1: Write the failing tests** — inside `mod tests` (after the `cr_thresholds()` fixture, ~line 193), add:

```rust
    #[test]
    fn next_worse_from_drift_is_depeg() {
        let t = cr_thresholds(); // drift=150 depeg=130 critical=110 black_swan=100
        assert_eq!(next_worse_cr_band(PegState::Drift, &t), Some(("DEPEG", 130)));
    }

    #[test]
    fn next_worse_from_depeg_is_critical() {
        assert_eq!(next_worse_cr_band(PegState::Depeg, &cr_thresholds()), Some(("CRITICAL", 110)));
    }

    #[test]
    fn next_worse_from_critical_is_black_swan() {
        assert_eq!(next_worse_cr_band(PegState::Critical, &cr_thresholds()), Some(("BLACK_SWAN", 100)));
    }

    #[test]
    fn next_worse_from_black_swan_or_pegged_is_none() {
        let t = cr_thresholds();
        assert_eq!(next_worse_cr_band(PegState::BlackSwan, &t), None);
        assert_eq!(next_worse_cr_band(PegState::Pegged, &t), None);
    }
```

- [ ] **Step 2: Run — expect FAIL** (function not defined):

Run: `cargo test -p pegana-methodology next_worse`
Expected: compile error — `cannot find function next_worse_cr_band`.

- [ ] **Step 3: Implement** — add after `state_for_cr` (~line 171):

```rust
/// The next-worse band below `current` for a CR-driven asset, as a display
/// label + its CR threshold (percent). `None` if already at the worst band
/// (BlackSwan) or not in an alerting band (Pegged/Unknown). Same dual-key
/// tolerance as `state_for_cr` (assets.toml `depeg` / DB JSONB `cr_depeg`).
pub fn next_worse_cr_band(
    current: PegState,
    thresholds: &HashMap<String, u32>,
) -> Option<(&'static str, u32)> {
    let get = |k: &str, alt: &str, d: u32| {
        thresholds.get(k).or_else(|| thresholds.get(alt)).copied().unwrap_or(d)
    };
    match current {
        PegState::Drift => Some(("DEPEG", get("depeg", "cr_depeg", 130))),
        PegState::Depeg => Some(("CRITICAL", get("critical", "cr_critical", 110))),
        PegState::Critical => Some(("BLACK_SWAN", get("black_swan", "cr_black_swan", 100))),
        _ => None,
    }
}
```

- [ ] **Step 4: Re-export from the crate root** — `lib.rs` uses an explicit (non-glob) re-export list, so the engine's `use pegana_methodology::next_worse_cr_band` only resolves if it's added. Edit `crates/methodology/src/lib.rs` lines 19-22:

```rust
pub use thresholds::{
    classify_with_hysteresis, is_direction_sensitive, next_worse_cr_band,
    state_for_bps_discount, state_for_bps_discount_aware, state_for_cr,
};
```

- [ ] **Step 5: Run — expect PASS**

Run: `cargo test -p pegana-methodology next_worse`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add crates/methodology/src/thresholds.rs crates/methodology/src/lib.rs
git commit -m "feat(methodology): next_worse_cr_band — next CR escalation band + threshold"
```

---

### Task 8: Engine — add `cr_next_band` / `cr_next_at` / `confidence` to alert `extra`

**Files:**
- Modify: `crates/engine-rs/src/main.rs` (import ~line 18-21; `extra` build block ~846-874)

- [ ] **Step 1: Import the helper** — add `next_worse_cr_band` to the `use pegana_methodology::{ … }` list (line ~18-21), e.g.:

```rust
use pegana_methodology::{
    // …existing imports…
    next_worse_cr_band, state_for_cr, Computed, InputsFrozen as MethInputsFrozen,
    PythEntry as MethPythEntry, Receipt,
};
```

- [ ] **Step 2: Compute the next band** — just after the `let cr_floor = …;` block (~line 846-851), add:

```rust
        // Next-worse CR band for the alert UI (CR-driven assets only; None
        // otherwise). Lets the bot show "next: DEPEG at 115% (15pp away)".
        let cr_next = asset_cfg
            .thresholds
            .thresholds_cr
            .as_ref()
            .and_then(|t| next_worse_cr_band(final_state, t));
```

- [ ] **Step 3: Add the fields to `extra`** — in the `serde_json::json!({ … })` for the `AlertEvent` (~line 863-874), add three keys alongside `cr` / `cr_floor`:

```rust
            extra: serde_json::json!({
                "cr": engine.hyusd_cr().await,
                "cr_floor": cr_floor,
                "cr_next_band": cr_next.map(|(b, _)| b),
                "cr_next_at": cr_next.map(|(_, at)| at),
                "confidence": confidence_label.to_string(),
                "cold_start": prev_opt.is_none(),
                "intrinsic_sol": i_sol_opt,
                "market_sol": m_sol_opt,
            }),
```

- [ ] **Step 4: Build — expect success**

Run: `cargo build -p engine-rs`
Expected: compiles. (No unit test here: `extra` is built inline in `recompute`; the methodology side is covered by Task 7 and the rendering side by Task 9 with mocked `extra`.)

- [ ] **Step 5: Commit**

```bash
git add crates/engine-rs/src/main.rs
git commit -m "feat(engine): forward cr_next_band/cr_next_at + confidence in alert extra"
```

---

### Task 9: Bot renderer — CR-led body, confidence line, USDS leak fix (`helpers.ts`, TDD)

**Files:**
- Modify: `bot-ts/src/helpers.ts` (add `oracleConfidence` to `AlertCopy` + `COPY_EN`; restructure `renderAlertTemplate` body ~375-407)
- Test: `bot-ts/test/helpers.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `bot-ts/test/helpers.test.ts`. NOTE: `renderAlertTemplate`, `describe`, `it`, `expect` are ALREADY imported at the top (verified) — do NOT add an import line. Append these blocks:

```ts
const cdpVars = (extra: Record<string, unknown>) => ({
  asset: "hyUSD", class: "stable_cdp",
  fromState: "PEGGED", toState: "DRIFT",
  discount: "-0.00272", intrinsic_usd: "1.0000", market_usd: "1.0027", extra,
});

describe("renderAlertTemplate — CR-driven body", () => {
  it("hyUSD leads with CR + next-band distance, spread demoted", () => {
    const out = renderAlertTemplate("alert_cdp", "en",
      cdpVars({ cr: "1.30", cr_floor: 100, cr_next_band: "DEPEG", cr_next_at: 115 }));
    expect(out).toContain("Collateral Ratio: <code>130.0%</code>");
    expect(out).toContain("entered DRIFT band");
    expect(out).toContain("next: DEPEG at 115% (15pp away)");
    expect(out).toContain("Market <code>$1.0027</code> vs intrinsic <code>$1.0000</code>");
    expect(out.indexOf("Collateral Ratio")).toBeLessThan(out.indexOf("Market"));
  });

  it("omits the next: line at the worst band", () => {
    const out = renderAlertTemplate("alert_cdp", "en", {
      asset: "hyUSD", class: "stable_cdp", fromState: "CRITICAL", toState: "BLACK_SWAN",
      discount: "0.05", intrinsic_usd: "1.0", market_usd: "0.95",
      extra: { cr: "0.98", cr_floor: 100 },
    });
    expect(out).toContain("Collateral Ratio");
    expect(out).not.toContain("next:");
  });
});

describe("renderAlertTemplate — USDS leak regression", () => {
  it("spread-driven CDP (no cr_floor) renders NO CR line even if extra.cr is set", () => {
    const out = renderAlertTemplate("alert_cdp", "en", {
      asset: "USDS", class: "stable_cdp", fromState: "PEGGED", toState: "DRIFT",
      discount: "0.0021", intrinsic_usd: "1.0000", market_usd: "0.9979",
      extra: { cr: "1.30", cr_floor: null }, // global hyUSD CR present; floor null
    });
    expect(out).not.toContain("Collateral Ratio");
    expect(out).not.toContain("130.0%");
    expect(out).toContain("Spread:");
  });
});

describe("renderAlertTemplate — oracle confidence", () => {
  const base = {
    asset: "USDC", class: "stable_fiat", fromState: "PEGGED", toState: "DRIFT",
    discount: "0.0020", intrinsic_usd: "1.0", market_usd: "0.998",
  };
  it("hidden when confidence is high", () => {
    expect(renderAlertTemplate("alert_stable", "en", { ...base, extra: { confidence: "high" } }))
      .not.toContain("Oracle confidence");
  });
  it("shown when degraded", () => {
    expect(renderAlertTemplate("alert_stable", "en", { ...base, extra: { confidence: "low" } }))
      .toContain("Oracle confidence: LOW");
    expect(renderAlertTemplate("alert_stable", "en", { ...base, extra: { confidence: "unknown" } }))
      .toContain("Oracle confidence: UNKNOWN");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd bot-ts && bun test test/helpers.test.ts`
Expected: FAIL — current renderer leads with Spread, has no `entered … band` / `next:` text, and renders a CR line for USDS (`extra.cr` guard).

- [ ] **Step 3: Add `oracleConfidence` to the `AlertCopy` interface** — in the interface (~line 127-168) add:

```ts
  /** Degraded-oracle warning lines, keyed by confidence label (not "high"). */
  oracleConfidence: Record<string, string>;
```

- [ ] **Step 4: Add the strings to `COPY_EN`** — inside the `COPY_EN` object (after `auditNoun`, ~line 194):

```ts
  oracleConfidence: {
    low: "⚠️ Oracle confidence: LOW — Pyth band wide; may be noise, not a real move",
    medium: "⚠️ Oracle confidence: MEDIUM — interpret with caution",
    unknown: "⚠️ Oracle confidence: UNKNOWN — feed stale or unavailable",
  },
```

- [ ] **Step 5: Restructure the body** — replace the body-building block (lines ~375-407, from `let body =` through the `if (template === "alert_cdp" …)` block, keeping the `alert_yield` footer) with:

```ts
  // CR-driven assets (hyUSD) change state because the COLLATERAL RATIO
  // crossed a band, not because of the market spread — so lead with CR and
  // demote spread to one context line. Gate on `cr_floor` (per-asset: only
  // CR-driven assets have thresholds_cr) — NOT on `cr`, which the engine
  // stamps globally and would otherwise leak hyUSD's CR into a USDS alert.
  const isCrDriven = extraObj.cr != null && extraObj.cr_floor != null;

  let body: string;
  if (isCrDriven) {
    const crPct = formatPct(String(extraObj.cr), { asRatio: true }); // "130.0%"
    let crBlock =
      `${escapeHtml(c.collateralRatio)} <code>${escapeHtml(crPct)}</code>` +
      ` — entered ${escapeHtml(stateLabel)} band`;
    const crNum = parseFloat(String(extraObj.cr));
    const nextBand = extraObj.cr_next_band;
    const nextAt = extraObj.cr_next_at;
    if (nextBand != null && nextAt != null && !isNaN(crNum)) {
      const away = Math.round(crNum * 100 - parseFloat(String(nextAt)));
      crBlock += `\n  next: ${escapeHtml(String(nextBand))} at ${escapeHtml(String(nextAt))}% (${away}pp away)`;
    }
    body =
      `${head}\n\n` +
      `${escapeHtml(c.state)} <code>${escapeHtml(from)}</code> → <code>${escapeHtml(to)}</code>\n` +
      `${crBlock}\n\n` +
      `Market <code>${marketCode}</code> vs intrinsic <code>${intrinsicCode}</code> (spread <code>${escapeHtml(discount)}</code>)`;
  } else {
    body =
      `${head}\n\n` +
      `${escapeHtml(c.state)} <code>${escapeHtml(from)}</code> → <code>${escapeHtml(to)}</code>\n` +
      `${escapeHtml(discountLabel)} <code>${escapeHtml(discount)}</code>${spreadTag}\n` +
      `${escapeHtml(intrinsicLabel)} <code>${intrinsicCode}</code>\n` +
      `${escapeHtml(c.market)}    <code>${marketCode}</code>`;
  }

  if (template === "alert_yield") {
    body += `\n\n<i>${escapeHtml(c.yieldFooter)}</i>`;
  }

  // Oracle confidence: surface only when degraded (not "high"). A DRIFT fired
  // off a wide/stale Pyth feed must read differently from a firm one.
  const conf = extraObj.confidence != null ? String(extraObj.confidence).toLowerCase() : null;
  if (conf && conf !== "high") {
    body += `\n\n${escapeHtml(c.oracleConfidence[conf] ?? c.oracleConfidence.low)}`;
  }
```

Note: `extraObj` is already defined earlier in the function (~line 353-356) and is used for the SOL-denominated peg view; reuse it. The old `if (template === "alert_cdp" && … extra.cr)` CR block is fully removed by this replacement.

- [ ] **Step 6: Run tests + typecheck + lint — expect PASS**

Run: `cd bot-ts && bun test && bun run typecheck && bun run lint`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add bot-ts/src/helpers.ts bot-ts/test/helpers.test.ts
git commit -m "feat(bot): CR-led alert body + next-band + oracle-confidence line; fix USDS CR leak"
```

---

## Final verification (whole branch)

- [ ] **Step 1: Rust workspace**

Run: `cargo test -p pegana-methodology -p engine-rs && cargo build`
Expected: PASS / compiles.

- [ ] **Step 2: Bot suite**

Run: `cd bot-ts && bun test && bun run typecheck && bun run lint`
Expected: all PASS.

- [ ] **Step 3: Confirm no pt-BR remnants in the bot**

Run: `cd bot-ts && grep -rni "pt-br\|pt_br\|COPY_PT\|/lang\|setLocale" src/ locales/`
Expected: no matches.

- [ ] **Step 4: Push the branch and open a PR** (only when the user asks).

---

## Out of scope (do NOT implement here)
- **WS3** — `/threshold` enforcement (replace `threshold_bps` with a min-severity-state filter in the dispatcher). Tracked separately; current Telegram delivery is band-only.
- **Backlog** — suppressed-recovery "all-clear"; richer daily digest; xSOL severity-scale wording.
- **Ops side-items** — `pegana-watch-daily` cron failure; R2-lifecycle note correction.
