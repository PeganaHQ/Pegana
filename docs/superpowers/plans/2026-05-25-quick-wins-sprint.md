# Quick-wins distribution sprint — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five small independent wins — fix the broken Telegram handle, add `/web` bot command, add `sub_*` deeplink confirmation, render dynamic OG images per asset, add Alert CTA to dashboard rows.

**Architecture:** Each deliverable is one or two files in isolation. No new dependencies. No DB migration. One new optional env var (`PEGANA_WEB_BASE` on the bot).

**Tech Stack:** Next.js 16.2.6 App Router · React 19 · Tailwind v4 · Bun + grammY 1.43 + Fluent · `next/og` ImageResponse · postgres-js.

**Spec:** `docs/superpowers/specs/2026-05-25-quick-wins-design.md`

---

## File map

| File | Action | Phase |
|---|---|---|
| `web/lib/bot-link.ts` | edit base URL | 1 |
| `web/tests/unit/lib/bot-link.test.ts` | edit asserts | 1 |
| `web/components/molecules/live-alert-bubble.tsx` | display string | 1 |
| `web/components/organisms/pinged-cta.tsx` | display string | 1 |
| `web/components/organisms/product-header.tsx` | display string | 1 |
| `web/components/organisms/how-it-works.tsx` | display string | 1 |
| `web/app/(marketing)/privacy/page.tsx` | display string | 1 |
| `web/app/(app)/developers/page.tsx` | display string | 1 |
| `web/app/(marketing)/about/page.tsx` | display string | 1 |
| `web/app/(marketing)/terms/page.tsx` | display string | 1 |
| `bot-ts/src/helpers.ts` | extend `parseStartPayload` | 3 |
| `bot-ts/test/helpers.test.ts` | new test cases | 3 |
| `bot-ts/src/index.ts` | `/start` flow, `/web` cmd, callbacks, menus | 2 + 3 |
| `bot-ts/locales/en.ftl` | new keys | 2 + 3 |
| `bot-ts/locales/pt-BR.ftl` | new keys (mirror) | 2 + 3 |
| `web/app/(app)/asset/[symbol]/opengraph-image.tsx` | new | 4 |
| `web/app/(app)/asset/[symbol]/twitter-image.tsx` | new (re-export) | 4 |
| `web/components/organisms/asset-table.tsx` | overlay Alert link | 5 |

---

## Phase 1 — Telegram handle fix

### Task 1.1: Update `bot-link.ts` and its test

**Files:**
- Modify: `web/lib/bot-link.ts:14`
- Modify: `web/tests/unit/lib/bot-link.test.ts`

- [ ] **Step 1.1.1: Update the test to assert the correct handle**

Replace the entire file:

```ts
import { describe, it, expect } from "vitest";
import { peganaBotHref } from "@/lib/bot-link";

describe("peganaBotHref", () => {
  it("emits a no-payload URL when called with no source", () => {
    expect(peganaBotHref()).toBe("https://t.me/PeganaWatchBot");
  });
  it("emits ?start=src_<source> for a source only", () => {
    expect(peganaBotHref("landing")).toBe("https://t.me/PeganaWatchBot?start=src_landing");
  });
  it("appends the asset symbol when supplied", () => {
    expect(peganaBotHref("asset", "jitoSOL")).toBe("https://t.me/PeganaWatchBot?start=src_asset_jitoSOL");
  });
  it("URL-encodes asset symbols with special characters", () => {
    expect(peganaBotHref("asset", "hyloSOL+")).toBe("https://t.me/PeganaWatchBot?start=src_asset_hyloSOL%2B");
  });
});
```

- [ ] **Step 1.1.2: Run test — expect FAIL**

```bash
cd web && bun run test tests/unit/lib/bot-link.test.ts
```

Expected: 4 failures asserting `PeganaWatchBot` but receiving `PeganaBot`.

- [ ] **Step 1.1.3: Edit `web/lib/bot-link.ts:14`**

Change:
```ts
const base = "https://t.me/PeganaBot";
```
To:
```ts
const base = "https://t.me/PeganaWatchBot";
```

- [ ] **Step 1.1.4: Run test — expect PASS**

```bash
cd web && bun run test tests/unit/lib/bot-link.test.ts
```

Expected: 4/4 pass.

- [ ] **Step 1.1.5: Commit**

```bash
git add web/lib/bot-link.ts web/tests/unit/lib/bot-link.test.ts
git commit -m "fix(web): correct Telegram handle in peganaBotHref (PeganaBot → PeganaWatchBot)"
```

### Task 1.2: Update stale display strings across the site

**Files:**
- Modify: `web/components/molecules/live-alert-bubble.tsx:94`
- Modify: `web/components/organisms/pinged-cta.tsx:74`
- Modify: `web/components/organisms/product-header.tsx:80`
- Modify: `web/components/organisms/how-it-works.tsx:40`
- Modify: `web/app/(marketing)/privacy/page.tsx:44`
- Modify: `web/app/(app)/developers/page.tsx:170`
- Modify: `web/app/(marketing)/about/page.tsx:53`
- Modify: `web/app/(marketing)/terms/page.tsx:57`

- [ ] **Step 1.2.1: Replace `@PeganaBot` with `@PeganaWatchBot` in each file**

For each file above, replace the literal string `@PeganaBot` with `@PeganaWatchBot`. The contexts are: section titles, link labels, mock-alert display strings, CTA labels. No code logic changes — only the visible string.

Quick sanity check after edits:

```bash
grep -rn "@PeganaBot\b" web/ --exclude-dir=node_modules --exclude-dir=.next
```

Expected: no matches.

- [ ] **Step 1.2.2: Build to confirm no breakage**

```bash
cd web && bun run build 2>&1 | tail -30
```

Expected: build succeeds (or fails only on pre-existing issues unrelated to these edits).

- [ ] **Step 1.2.3: Commit**

```bash
git add -A web/components web/app
git commit -m "fix(web): update stale @PeganaBot mentions to @PeganaWatchBot"
```

---

## Phase 2 — `/web` bot command

### Task 2.1: Add Fluent keys for `/web`

**Files:**
- Modify: `bot-ts/locales/en.ftl`
- Modify: `bot-ts/locales/pt-BR.ftl`

- [ ] **Step 2.1.1: Append to `bot-ts/locales/en.ftl`**

Add at end of file (one blank line above):

```
# /web — personalized dashboard link
web-link-no-subs =
    📊 Pegana dashboard:
    <a href="{ $url }">{ $url }</a>

    Tip: use /subscribe &lt;asset&gt; to start tracking — then /web will deep-link straight to it.
web-link-with-subs =
    📊 Your dashboard:
    <a href="{ $url }">{ $url }</a>

    { $others ->
        [empty] { "" }
       *[other] Also watching: { $others }
    }
```

> **Note on Fluent indent-start ban:** the spec lists this as a known gotcha — any line starting with `*`, `[`, `{`, `}` or `.` gets the whole message silently dropped. The `[empty]` / `*[other]` selectors above are at standard indent (4 spaces) which Fluent accepts because they are part of the selector grammar. If the message lookup returns `{web-link-with-subs}` literally at runtime, escape the leading bracket with `{ "[" }empty]` etc.

- [ ] **Step 2.1.2: Append to `bot-ts/locales/pt-BR.ftl`**

```
# /web — link do painel personalizado
web-link-no-subs =
    📊 Painel da Pegana:
    <a href="{ $url }">{ $url }</a>

    Dica: use /subscribe &lt;ativo&gt; pra começar a monitorar — aí /web abre direto.
web-link-with-subs =
    📊 Seu painel:
    <a href="{ $url }">{ $url }</a>

    { $others ->
        [empty] { "" }
       *[other] Também monitorando: { $others }
    }
```

### Task 2.2: Add `/web` handler

**Files:**
- Modify: `bot-ts/src/index.ts`

- [ ] **Step 2.2.1: Read the env once at module top**

After the existing `Env` schema (around line 65), extend with an optional `PEGANA_WEB_BASE`:

```ts
const Env = z.object({
  BOT_TOKEN: z.string().min(10, "BOT_TOKEN required"),
  DATABASE_URL: z.string(),
  BOT_INTERNAL_PORT: z.coerce.number().int().default(3000),
  BOT_INTERNAL_SECRET: z.string().min(8),
  FEATURE_PUBLIC_ALERTS: z
    .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0"), z.literal("")])
    .transform((s) => s === "true" || s === "1")
    .default("false"),
  DOGFOOD_TELEGRAM_CHAT_ID: z.coerce.number().int().optional(),
  PEGANA_WEB_BASE: z.string().url().default("https://pegana.xyz"),
});
```

- [ ] **Step 2.2.2: Add the `/web` handler immediately after the existing `/digest` block**

Find the end of `bot.command("digest", ...)` handler (around line 521) and add:

```ts
bot.command("web", withCmd("web", async (ctx) => {
  if (await rejectGroupIfNoDm(ctx)) return;
  const user = await getUserOrCreate(ctx);
  const subs = await db.listUserSubs(user.id);
  if (subs.length === 0) {
    const url = `${env.PEGANA_WEB_BASE}/dashboard`;
    return replyT(ctx, "web-link-no-subs", { url });
  }
  // Deterministic primary = lowest-ID active sub (oldest).
  const sorted = [...subs].sort((a, b) => a.id - b.id);
  const primary = sorted[0]!;
  const others = sorted.slice(1).map((s) => s.asset).join(", ");
  const url = `${env.PEGANA_WEB_BASE}/asset/${encodeURIComponent(primary.asset)}`;
  await replyT(ctx, "web-link-with-subs", { url, others });
}));
```

- [ ] **Step 2.2.3: Register `/web` in the Telegram command menus**

In `COMMANDS_EN` array (around line 746) add at the end before `lang`:

```ts
  { command: "web",         description: "Open your dashboard on the web" },
```

In `COMMANDS_PT` add:

```ts
  { command: "web",         description: "Abre seu painel na web" },
```

- [ ] **Step 2.2.4: Smoke test the handler against prod-local**

Manual test — requires the bot running locally with `docker-compose -f docker-compose.local.yml up bot`:

```text
1. Send `/web` to @PeganaWatchBot from a chat with zero subs.
   Expected: "📊 Pegana dashboard: https://pegana.xyz/dashboard ..." (tip line).
2. Run `/subscribe jitoSOL 0.5` then `/web`.
   Expected: "📊 Your dashboard: https://pegana.xyz/asset/jitoSOL" (no others line).
3. Add `/subscribe mSOL 1.0` then `/web`.
   Expected: same primary URL + "Also watching: mSOL".
```

If `web-link-with-subs` renders as literal `{web-link-with-subs}` in step 2/3, the Fluent selector is being dropped — see step 2.1.1 escape note.

- [ ] **Step 2.2.5: Commit**

```bash
git add bot-ts/src/index.ts bot-ts/locales/en.ftl bot-ts/locales/pt-BR.ftl
git commit -m "feat(bot): /web command returns personalized dashboard URL"
```

---

## Phase 3 — `sub_*` deeplink confirmation

### Task 3.1: Extend `parseStartPayload` to discriminated union

**Files:**
- Modify: `bot-ts/src/helpers.ts:56-66`
- Modify: `bot-ts/test/helpers.test.ts` (parseStartPayload block at ~line 42)

- [ ] **Step 3.1.1: Update existing tests to use the new return shape**

Replace the existing `describe("parseStartPayload", ...)` block with:

```ts
describe("parseStartPayload", () => {
  it("returns null for empty / non-prefixed input", () => {
    expect(parseStartPayload(undefined)).toBeNull();
    expect(parseStartPayload("")).toBeNull();
    expect(parseStartPayload("anything")).toBeNull();
  });
  it("returns a source payload for src_<source>", () => {
    expect(parseStartPayload("src_landing_cta")).toEqual({ kind: "source", source: "landing_cta" });
    expect(parseStartPayload("src_asset_jitoSOL")).toEqual({ kind: "source", source: "asset_jitoSOL" });
  });
  it("returns null when only 'src_' is present", () => {
    expect(parseStartPayload("src_")).toBeNull();
  });
  it("trims whitespace", () => {
    expect(parseStartPayload("  src_x  ")).toEqual({ kind: "source", source: "x" });
  });
  it("returns a subscribe payload for sub_<asset>_<bps>", () => {
    expect(parseStartPayload("sub_jitoSOL_50")).toEqual({ kind: "subscribe", asset: "jitoSOL", bps: 50 });
    expect(parseStartPayload("sub_mSOL_100")).toEqual({ kind: "subscribe", asset: "mSOL", bps: 100 });
  });
  it("supports asset symbols with '+' (e.g. hyloSOL+)", () => {
    expect(parseStartPayload("sub_hyloSOL+_30")).toEqual({ kind: "subscribe", asset: "hyloSOL+", bps: 30 });
  });
  it("rejects sub_ payloads with non-numeric bps", () => {
    expect(parseStartPayload("sub_jitoSOL_abc")).toBeNull();
  });
  it("rejects sub_ payloads with bps <= 0", () => {
    expect(parseStartPayload("sub_jitoSOL_0")).toBeNull();
    expect(parseStartPayload("sub_jitoSOL_-5")).toBeNull();
  });
  it("rejects sub_ payloads with bps > 10000 (i.e. > 100%)", () => {
    expect(parseStartPayload("sub_jitoSOL_10001")).toBeNull();
  });
  it("rejects malformed sub_ payloads", () => {
    expect(parseStartPayload("sub_jitoSOL")).toBeNull();
    expect(parseStartPayload("sub__50")).toBeNull();
  });
});
```

- [ ] **Step 3.1.2: Run tests — expect FAIL**

```bash
cd bot-ts && bun test test/helpers.test.ts
```

Expected: parseStartPayload block fails (string vs object mismatch, missing subscribe cases).

- [ ] **Step 3.1.3: Update `parseStartPayload` in `helpers.ts`**

Replace lines 56-66:

```ts
/**
 * Telegram deep-link payload parser. Two shapes are supported:
 *
 *   `src_<source>[_<asset>]` → attribution only — returns
 *     `{ kind: "source", source }`. The `source` string is persisted
 *     on `users.source` for funnel analytics.
 *
 *   `sub_<asset>_<bps>` → subscribe intent — returns
 *     `{ kind: "subscribe", asset, bps }`. The /start handler sends a
 *     confirmation keyboard; nothing is written to the DB until the
 *     user clicks "Confirm".
 *
 * Returns null for any malformed input. `bps` must be in (0, 10000].
 * Asset accepts `[A-Za-z0-9+]+` to support `hyloSOL+` style symbols.
 */
export type StartPayload =
  | { kind: "source"; source: string }
  | { kind: "subscribe"; asset: string; bps: number };

export function parseStartPayload(raw: string | undefined): StartPayload | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith("src_")) {
    const source = trimmed.slice("src_".length);
    return source ? { kind: "source", source } : null;
  }
  const subMatch = trimmed.match(/^sub_([A-Za-z0-9+]+)_(-?\d+)$/);
  if (subMatch) {
    const [, asset, bpsRaw] = subMatch;
    const bps = parseInt(bpsRaw!, 10);
    if (bps > 0 && bps <= 10_000) {
      return { kind: "subscribe", asset: asset!, bps };
    }
  }
  return null;
}
```

- [ ] **Step 3.1.4: Run tests — expect PASS**

```bash
cd bot-ts && bun test test/helpers.test.ts
```

Expected: every `parseStartPayload` test passes. Other helpers unchanged.

- [ ] **Step 3.1.5: Commit**

```bash
git add bot-ts/src/helpers.ts bot-ts/test/helpers.test.ts
git commit -m "feat(bot): parseStartPayload returns discriminated union with sub_<asset>_<bps>"
```

### Task 3.2: Wire the confirmation flow into `/start`

**Files:**
- Modify: `bot-ts/src/index.ts:251-279` (the `/start` handler)
- Modify: `bot-ts/src/index.ts` (new callbackQuery handlers)

- [ ] **Step 3.2.1: Update the `/start` handler**

Replace the existing `bot.command("start", ...)` body. Show entire new handler (preserves welcome photo, banner, locale pinning):

```ts
bot.command("start", withCmd("start", async (ctx) => {
  const payload = parseStartPayload(ctx.match);
  const source = payload?.kind === "source" ? payload.source : null;
  const user = await getUserOrCreate(ctx, source);
  if (user.locale === "pt-BR" || user.locale === "en") {
    ctx.session.locale = user.locale;
    await ctx.i18n.useLocale(user.locale);
  }
  try {
    await ctx.replyWithPhoto(new InputFile(WELCOME_PHOTO_PATH), {
      caption: ctx.t("welcome"),
      parse_mode: "HTML",
    });
  } catch (err) {
    log.warn({ err }, "welcome photo failed; falling back to text");
    await replyT(ctx, "welcome");
  }
  if (!env.FEATURE_PUBLIC_ALERTS) {
    await replyT(ctx, "private_beta_banner");
  }
  // Subscribe-intent deeplink — render a confirmation keyboard after the
  // welcome. The user must explicitly confirm; nothing is written yet.
  if (payload?.kind === "subscribe") {
    const asset = await db.getAsset(payload.asset);
    if (!asset) {
      await replyT(ctx, "unknown_asset", { symbol: payload.asset });
      return;
    }
    const pct = bpsToPct(payload.bps);
    const kb = new InlineKeyboard()
      .text(ctx.t("sub-confirm-button-yes"), `subok:${asset.symbol}:${payload.bps}`).row()
      .text(ctx.t("sub-confirm-button-custom"), `subcust:${asset.symbol}`).row()
      .text(ctx.t("sub-confirm-button-cancel"), "subno");
    await ctx.reply(ctx.t("sub-confirm", { asset: asset.symbol, pct }), {
      parse_mode: "HTML",
      reply_markup: kb,
    });
  }
}));
```

- [ ] **Step 3.2.2: Add the three callback handlers**

Place immediately after the existing `bot.callbackQuery(/^unsub:(\d+)$/, ...)` block (around line 338):

```ts
bot.callbackQuery(/^subok:([A-Za-z0-9+]+):(\d+)$/, async (ctx) => {
  const asset = ctx.match[1]!;
  const bps = parseInt(ctx.match[2]!, 10);
  const user = await getUserOrCreate(ctx);
  const a = await db.getAsset(asset);
  if (!a) {
    await ctx.answerCallbackQuery();
    return;
  }
  await db.subscribe(user.id, a.symbol, bps);
  await ctx.answerCallbackQuery(ctx.t("sub-confirmed-short"));
  // Replace the message body to remove the keyboard and show success state.
  try {
    await ctx.editMessageText(
      ctx.t("sub-confirmed", { asset: a.symbol, pct: bpsToPct(bps) }),
      { parse_mode: "HTML" },
    );
  } catch {
    /* ignore — message may be too old to edit */
  }
});

bot.callbackQuery(/^subcust:([A-Za-z0-9+]+)$/, async (ctx) => {
  const asset = ctx.match[1]!;
  await ctx.answerCallbackQuery();
  await ctx.reply(ctx.t("sub-custom-hint", { asset }), { parse_mode: "HTML" });
});

bot.callbackQuery(/^subno$/, async (ctx) => {
  await ctx.answerCallbackQuery(ctx.t("sub-cancelled"));
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  } catch {
    /* ignore */
  }
});
```

- [ ] **Step 3.2.3: Add Fluent keys (en + pt-BR)**

Append to `bot-ts/locales/en.ftl`:

```
# /start sub_<asset>_<bps> deeplink confirmation
sub-confirm = Subscribe to <b>{ $asset }</b> at <b>{ $pct }%</b> threshold?
sub-confirm-button-yes = Yes — subscribe
sub-confirm-button-custom = Change threshold first
sub-confirm-button-cancel = No, thanks
sub-confirmed = Subscribed to <b>{ $asset }</b> at <b>{ $pct }%</b>. You'll get a Telegram alert the moment Pegana detects a state transition out of PEGGED.
sub-confirmed-short = Subscribed
sub-cancelled = Cancelled
sub-custom-hint = Use <code>/threshold { $asset } &lt;pct&gt;</code> to pick a different threshold (e.g. <code>/threshold { $asset } 0.3</code>).
```

Append to `bot-ts/locales/pt-BR.ftl`:

```
# Confirmação de assinatura via deeplink sub_<ativo>_<bps>
sub-confirm = Assinar <b>{ $asset }</b> com threshold de <b>{ $pct }%</b>?
sub-confirm-button-yes = Sim — assinar
sub-confirm-button-custom = Alterar threshold antes
sub-confirm-button-cancel = Não, obrigado
sub-confirmed = Assinatura ativa em <b>{ $asset }</b> com <b>{ $pct }%</b>. Você vai receber um alerta no Telegram assim que a Pegana detectar uma transição de estado saindo de PEGGED.
sub-confirmed-short = Assinado
sub-cancelled = Cancelado
sub-custom-hint = Use <code>/threshold { $asset } &lt;pct&gt;</code> pra escolher outro threshold (ex.: <code>/threshold { $asset } 0.3</code>).
```

- [ ] **Step 3.2.4: Manual smoke**

With the bot running locally:

```text
1. Open `t.me/PeganaWatchBot?start=sub_jitoSOL_50` in a fresh chat.
   Expected: welcome photo + banner + confirmation message with 3 buttons.
2. Click "Yes — subscribe".
   Expected: callback toast "Subscribed"; message edits to "Subscribed to jitoSOL at 0.50%…".
   Verify: `/list` includes jitoSOL @ 0.50%.
3. Open `t.me/PeganaWatchBot?start=sub_jitoSOL_75` and click "No, thanks".
   Expected: keyboard disappears; no new sub.
4. Open `t.me/PeganaWatchBot?start=sub_jitoSOL_25` and click "Change threshold first".
   Expected: hint message with /threshold usage.
5. Open `t.me/PeganaWatchBot?start=sub_NOTANASSET_50`.
   Expected: welcome flow + "unknown asset NOTANASSET" reply, no confirmation message.
```

- [ ] **Step 3.2.5: Commit**

```bash
git add bot-ts/src/index.ts bot-ts/locales/en.ftl bot-ts/locales/pt-BR.ftl
git commit -m "feat(bot): sub_<asset>_<bps> deeplink → confirmation keyboard in /start"
```

---

## Phase 4 — Per-asset Open Graph image

### Task 4.1: Create the OG renderer

**Files:**
- Create: `web/app/(app)/asset/[symbol]/opengraph-image.tsx`

- [ ] **Step 4.1.1: Skim Next 16 ImageResponse docs**

Read once before editing:

```bash
sed -n '78,160p' web/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/opengraph-image.md
```

Key facts confirmed:
- `params` is `Promise<{ symbol: string }>` (v16 breaking change from sync).
- Default export returns `ImageResponse` from `next/og`.
- `size`, `alt`, `contentType` are static module exports.
- The file is a special Route Handler — works alongside a `"use client"` `page.tsx` in the same segment.

- [ ] **Step 4.1.2: Create the file**

```tsx
import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "Pegana — peg status";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080";

interface AssetData {
  symbol: string;
  name: string | null;
  state: "PEGGED" | "DRIFT" | "DEPEG" | "CRITICAL" | "BLACK_SWAN" | "UNKNOWN" | null;
  discount: string | null;
  intrinsic_usd: string | null;
  market_usd: string | null;
  peg_target?: string | null;
}

const STATE_COLOR: Record<string, string> = {
  PEGGED: "#3fa776",
  DRIFT: "#c08a55",
  DEPEG: "#c34a4a",
  CRITICAL: "#c34a4a",
  BLACK_SWAN: "#c34a4a",
  UNKNOWN: "#7d909d",
};

function bpsFromDiscount(d: string | null): number | null {
  if (d == null) return null;
  const n = parseFloat(d);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 10000);
}

function formatGap(bps: number | null): string {
  if (bps == null) return "—";
  if (bps === 0) return "0 bps";
  const sign = bps > 0 ? "+" : "−";
  const abs = Math.abs(bps);
  if (abs < 100) return `${sign}${abs} bps`;
  const pct = abs / 100;
  if (abs < 1000) return `${sign}${pct.toFixed(2)}%`;
  return `${sign}${pct.toFixed(1)}%`;
}

function trimDecimal(s: string | null): string {
  if (!s) return "—";
  const n = parseFloat(s);
  if (Number.isNaN(n)) return s;
  return Math.abs(n) >= 1 ? n.toFixed(4) : n.toFixed(6);
}

export default async function Image({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol: rawSymbol } = await params;
  const symbol = decodeURIComponent(rawSymbol);

  let asset: AssetData | null = null;
  try {
    const r = await fetch(`${API_BASE}/v1/assets/${encodeURIComponent(symbol)}`, {
      cache: "no-store",
    });
    if (r.ok) asset = (await r.json()) as AssetData;
  } catch {
    /* fall through to generic card */
  }

  const state = asset?.state ?? "UNKNOWN";
  const stateColor = STATE_COLOR[state] ?? STATE_COLOR.UNKNOWN!;
  const bps = bpsFromDiscount(asset?.discount ?? null);
  const gap = formatGap(bps);
  const unit = asset?.peg_target ?? "USD";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#000",
          color: "#fffdf9",
          padding: "64px 80px",
          display: "flex",
          flexDirection: "column",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Brand mark */}
        <div
          style={{
            display: "flex",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 28,
            color: "#6f879c",
            letterSpacing: "0.04em",
          }}
        >
          [ pegana ]
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 24,
          }}
        >
          {/* Left — symbol + state pill */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                fontSize: 160,
                fontWeight: 500,
                lineHeight: 1,
                letterSpacing: "-0.04em",
              }}
            >
              {asset ? asset.symbol : "pegana.xyz"}
            </div>
            {asset && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  marginTop: 32,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 32,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: stateColor,
                }}
              >
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    background: stateColor,
                  }}
                />
                {state.toLowerCase().replace("_", " ")}
              </div>
            )}
          </div>

          {/* Right — figures */}
          {asset && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 28,
                color: "#6f879c",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", color: stateColor, fontSize: 56 }}>
                {gap}
              </div>
              <div style={{ display: "flex" }}>intrinsic {trimDecimal(asset.intrinsic_usd)} {unit}</div>
              <div style={{ display: "flex" }}>market {trimDecimal(asset.market_usd)} {unit}</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 20,
            color: "#6f879c",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          <div style={{ display: "flex" }}>pegana.xyz</div>
          <div style={{ display: "flex" }}>live · monitored 24/7</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
```

- [ ] **Step 4.1.3: Smoke test in the dev server**

```bash
cd web && bun run dev
```

In a browser, visit:
- `http://localhost:3000/asset/jitoSOL/opengraph-image` — should return a 1200x630 PNG with jitoSOL data.
- `http://localhost:3000/asset/NOTANASSET/opengraph-image` — should return a generic "pegana.xyz" fallback PNG.

If the fetch fails (no backend running), the fallback path still renders the brand card without asset data.

- [ ] **Step 4.1.4: Confirm `<meta>` tags are injected on the page**

Visit `http://localhost:3000/asset/jitoSOL` and view source. Look for:

```html
<meta property="og:image" content="/asset/jitoSOL/opengraph-image?...">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/png">
<meta property="og:image:alt" content="Pegana — peg status">
```

If absent: the file convention isn't being picked up. Check the file is in the correct segment (`web/app/(app)/asset/[symbol]/`) and that Next picks up the route group.

### Task 4.2: Add the Twitter card re-export

**Files:**
- Create: `web/app/(app)/asset/[symbol]/twitter-image.tsx`

- [ ] **Step 4.2.1: Create the file**

```tsx
export { default, alt, size, contentType, runtime } from "./opengraph-image";
```

That's the entire file. Next's file convention scans for `twitter-image.tsx` and applies the same image plus `<meta name="twitter:image">` tags.

- [ ] **Step 4.2.2: Verify on page source**

Reload `http://localhost:3000/asset/jitoSOL` and view source. Look for:

```html
<meta name="twitter:image" content="/asset/jitoSOL/twitter-image?...">
```

- [ ] **Step 4.2.3: Commit**

```bash
git add web/app/\(app\)/asset/\[symbol\]/opengraph-image.tsx web/app/\(app\)/asset/\[symbol\]/twitter-image.tsx
git commit -m "feat(web): dynamic OG/Twitter image per asset via Next 16 file convention"
```

---

## Phase 5 — Asset table Alert CTA

### Task 5.1: Overlay Alert link on hover

**Files:**
- Modify: `web/components/organisms/asset-table.tsx`

Context: `TableRow` is currently wrapped in a `<Link>`, so a child `<button>` or `<a>` would be invalid nested-interactive HTML. Solution: change the wrapper from `<Link>` to `<div>` and add the body as a child `<Link>`. Place the Alert affordance as a sibling absolutely-positioned overlay.

- [ ] **Step 5.1.1: Restructure the `TableRow` markup**

Find `TableRow` (line 65) and replace the entire `return (...)` block with:

```tsx
  return (
    <div
      data-table-row
      data-asset={a.symbol}
      className="group relative"
      onMouseEnter={() => onRowHover?.(a.symbol)}
      onMouseLeave={() => onRowHover?.(null)}
    >
      <Link
        href={`/asset/${a.symbol}`}
        className="block focus-visible:outline focus-visible:outline-1 focus-visible:outline-text focus-visible:outline-offset-[-1px]"
      >
        <div className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-hairline px-4 py-3 transition-colors duration-300 group-hover:bg-surface-1/40 sm:grid-cols-[1.6fr_70px_140px_60px_110px_110px] sm:gap-4">
          {/* Asset col */}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <WatchlistToggle symbol={a.symbol} size="sm" />
              <span className="font-medium text-[15px] text-text">{a.symbol}</span>
              {lowLiq && (
                <span title="Thin secondary market" className="border border-hairline px-1 py-px font-mono text-[8px] uppercase tracking-[0.1em] text-text-muted">
                  thin
                </span>
              )}
            </div>
            {a.name && (
              <div className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.06em] text-text-muted">
                {a.name}
              </div>
            )}
          </div>

          {/* Class chip */}
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.06em] text-text-muted sm:inline-block">
            {classLabel[a.class] ?? a.class}
          </span>

          {/* 24h sparkline */}
          <span className="hidden h-6 w-full max-w-[140px] items-center sm:flex">
            <SparklineCell symbol={a.symbol} className="h-6 w-full" />
          </span>

          {/* Safety grade */}
          <span
            className={cn(
              "hidden text-center font-mono text-[14px] font-medium tracking-tight sm:block",
              gradeColor[grade],
            )}
            title={`Safety grade ${grade}`}
          >
            {grade}
          </span>

          {/* Spread + state pip */}
          <div className="flex flex-col items-end gap-0.5 text-right sm:items-end sm:gap-0">
            <span ref={spreadRef} className={cn("font-mono text-[13px] font-medium", spreadColor)}>
              {formatGap(bps)}
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-text-muted sm:hidden">
              spread
            </span>
          </div>

          {/* State */}
          <div className="hidden items-center justify-end gap-2 sm:flex">
            <StatePip state={state} pulse={state !== "PEGGED"} size={6} announce />
            <span className={cn("font-mono text-[11px] uppercase tracking-[0.06em]", stateColorClass[state])}>
              {state.toLowerCase().replace("_", " ")}
            </span>
          </div>
        </div>
      </Link>

      {/* Hover-revealed Alert link — absolutely positioned to avoid nested anchors */}
      <a
        href={peganaBotHref("dashboard", a.symbol)}
        target="_blank"
        rel="noreferrer"
        aria-label={`Alert me on ${a.symbol}`}
        className="absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1.5 border border-hairline bg-canvas/90 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-text-muted opacity-0 backdrop-blur transition-opacity duration-200 hover:border-outline hover:text-text group-hover:opacity-100 sm:inline-flex"
      >
        alert
        <span aria-hidden>→</span>
      </a>
    </div>
  );
```

- [ ] **Step 5.1.2: Add the `peganaBotHref` import**

At the top of the file (the import block, around line 1-18), add:

```ts
import { peganaBotHref } from "@/lib/bot-link";
```

- [ ] **Step 5.1.3: Smoke test in the dev server**

```bash
cd web && bun run dev
```

In a browser visit `http://localhost:3000/dashboard` and:

```text
1. Hover any row — the "alert →" pill appears at the right edge.
2. Click the pill — opens `https://t.me/PeganaWatchBot?start=src_dashboard_<symbol>` in a new tab.
3. Click anywhere else on the row — navigates to `/asset/<symbol>`.
4. Resize to mobile (`<640px`) — the alert pill is hidden (`sm:inline-flex`); mobile users use the bottom action strip on the asset page.
```

- [ ] **Step 5.1.4: Commit**

```bash
git add web/components/organisms/asset-table.tsx
git commit -m "feat(web): hover-revealed Alert CTA on dashboard table rows"
```

---

## Phase 6 — Final verification

### Task 6.1: Full test suites

- [ ] **Step 6.1.1: Run web unit tests**

```bash
cd web && bun run test 2>&1 | tail -30
```

Expected: all tests pass (only `bot-link.test.ts` was touched in scope; rest should be unchanged).

- [ ] **Step 6.1.2: Run bot tests**

```bash
cd bot-ts && bun test 2>&1 | tail -30
```

Expected: all helpers tests pass; integration tests skipped (gated on `PEGANA_INTEGRATION_DB`).

- [ ] **Step 6.1.3: TypeScript check**

```bash
cd web && bun run typecheck 2>&1 | tail -20
cd bot-ts && bunx tsc --noEmit 2>&1 | tail -20
```

Expected: no new type errors. The `parseStartPayload` return-type change affects only one caller (the `/start` handler updated in Task 3.2).

- [ ] **Step 6.1.4: Web build**

```bash
cd web && bun run build 2>&1 | tail -40
```

Expected: build completes. Look for the new dynamic route registered:
```
λ /asset/[symbol]/opengraph-image
λ /asset/[symbol]/twitter-image
```

### Task 6.2: Manual end-to-end smoke against prod-local

Requires the prod-local docker stack: `docker compose -f docker-compose.local.yml up -d`.

- [ ] **Step 6.2.1: Verify every Telegram CTA on the live site**

Open in a browser:
- `http://localhost:3001/about` — click "@PeganaWatchBot →" → opens `t.me/PeganaWatchBot?start=src_about`.
- `http://localhost:3001/asset/jitoSOL` — bottom action strip → "Get pinged on flips" → opens `t.me/PeganaWatchBot?start=src_asset_jitoSOL`.
- `http://localhost:3001/dashboard` — hover row → alert pill → opens `t.me/PeganaWatchBot?start=src_dashboard_<symbol>`.
- Footer link from any page → `t.me/PeganaWatchBot`.

- [ ] **Step 6.2.2: Verify bot side**

In Telegram:
- `/web` (with 0 subs) → returns dashboard URL.
- `/subscribe jitoSOL 0.5` then `/web` → returns asset URL.
- `t.me/PeganaWatchBot?start=sub_mSOL_100` → confirmation keyboard → confirm → `/list` shows mSOL @ 1.00%.

- [ ] **Step 6.2.3: Verify OG image renders**

Visit `http://localhost:3001/asset/jitoSOL/opengraph-image` directly and confirm the PNG renders with current state + numbers.

### Task 6.3: Push and open PR

- [ ] **Step 6.3.1: Push branch**

```bash
git push -u origin feat/quick-wins-sprint
```

- [ ] **Step 6.3.2: Open PR**

```bash
gh pr create --title "Quick-wins distribution sprint" --body "$(cat <<'EOF'
## Summary
- Fix broken Telegram handle in peganaBotHref (was `PeganaBot`, now `PeganaWatchBot`) — every Telegram CTA on the site was sending users to the wrong bot.
- New `/web` bot command that returns a personalized dashboard URL.
- Extend `?start=` payload to support `sub_<asset>_<bps>` — opens a confirmation keyboard inside Telegram, cutting funnel from 3 manual messages to 1 click.
- Dynamic Open Graph & Twitter images per asset (`/asset/<symbol>` shares now carry live peg status as a card).
- Hover-revealed Alert CTA on dashboard table rows.

Spec: `docs/superpowers/specs/2026-05-25-quick-wins-design.md`
Plan: `docs/superpowers/plans/2026-05-25-quick-wins-sprint.md`

## Test plan
- [x] `bun test` passes in web/ and bot-ts/
- [x] Manual: every Telegram CTA on the site opens the correct bot
- [x] Manual: `t.me/PeganaWatchBot?start=sub_jitoSOL_50` → confirmation → /list reflects sub
- [x] Manual: `/asset/<X>/opengraph-image` returns a per-asset PNG with live state
- [x] Manual: `/web` returns the right URL for 0-sub and N-sub users

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

| Spec requirement | Implementing task(s) |
|---|---|
| Fix `peganaBotHref` handle | 1.1 |
| Fix stale display strings | 1.2 |
| `/web` command | 2.1, 2.2 |
| `parseStartPayload` discriminated union | 3.1 |
| `/start` sub_ confirmation flow | 3.2 |
| OG image file convention | 4.1 |
| Twitter image re-export | 4.2 |
| Dashboard Alert CTA (asset-table) | 5.1 |
| (Out of scope) Universe-grid CTA | — deferred (portraits too small; design judgment from audit) |
| (Out of scope) `/embed` polish | — already shipped per audit |
| (Out of scope) `AssetCard` refactor | — dead code per audit |

Type consistency: `StartPayload` is defined in Task 3.1.3 and used in Task 3.2.1 (`payload?.kind === "source" | "subscribe"`). `peganaBotHref` is imported in Task 5.1.2 before use. `bpsToPct` is imported from helpers in `index.ts` already (line 18 — unchanged).

No placeholders. No "TBD" or "implement appropriately". Every code step contains the actual code.
