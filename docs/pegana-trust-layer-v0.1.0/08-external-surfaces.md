> ⚠️ **AMENDED** — see [`AMENDMENTS.md`](AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original spec preserved below as historical reference.

---

# 08 — External Surfaces (MCP, Bot, Webhook, Embed Widget)

> Changes to non-web user-facing surfaces. MCP gets new `verify_alert` tool + extended `subscribe_peg_events`. Bot adds evidence link to 5 templates × 2 languages. Webhook payload gains `evidence_url`. New embed widget at `/embed.js` and `/embed/[asset]`.

---

## 1. MCP — new + extended tools

### Extended: `subscribe_peg_events`

File: `mcp-ts/src/tools/subscribe-peg-events.ts`. Already returns `content` (text JSON) + `structuredContent`. Adds `evidence_url` to each event.

**Schema change**:
```typescript
const alertEvent = z.object({
  id: z.string(),
  asset: z.string(),
  from_state: z.enum(PEG_STATES),
  to_state: z.enum(PEG_STATES),
  discount: z.string().describe("Signed decimal at the moment of state transition."),
  ts: z.number().int().describe("Unix seconds of the transition."),
  evidence_url: z.string().url().describe(
    "Public URL of the alert's audit receipt — inputs, methodology version, replay bundle download."
  ),  // NEW
});
```

**Handler change** (build evidence_url from `AUDIT_BASE_URL` env):
```typescript
const auditBase = process.env.AUDIT_BASE_URL ?? "https://pegana.xyz";
const events = result.rows.map((r) => ({
  ...r,
  from_state: normalizePegState(r.from_state),
  to_state: normalizePegState(r.to_state),
  evidence_url: `${auditBase}/audit/${r.id}`,  // NEW
}));
```

**Backward compatibility**: existing MCP clients that don't know about `evidence_url` ignore unknown fields per JSON Schema permissive semantics. Verified by re-running existing integration tests post-change.

**Description appended**: "Each event includes `evidence_url` — a public link to the alert's audit receipt for verification."

### New: `verify_alert(alert_id)` — free tool

File: `mcp-ts/src/tools/verify-alert.ts` (NEW).

```typescript
import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

const API_BASE = process.env.PEGANA_API ?? "https://api.pegana.xyz";

export const verifyAlertTool = {
  name: "verify_alert",
  description:
    "Free. Fetches the public audit receipt for a given alert UUID. Returns inputs frozen, " +
    "methodology version, computed outputs, replay bundle URL, receipt sha256, and on-chain " +
    "tx signature (if committed). Use after `subscribe_peg_events` to verify a specific alert, " +
    "or to investigate any alert URL the user shares.",
  inputSchema: {
    alert_id: z.string().uuid().describe(
      "Alert UUID (from subscribe_peg_events.id or the last segment of /audit/<id>)."
    ),
  },
  annotations: {
    title: "Fetch audit receipt for an alert (free)",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  } satisfies ToolAnnotations,
  async handler(args: { alert_id: string }) {
    const url = `${API_BASE}/v1/audit/${args.alert_id}`;
    const resp = await fetch(url, { method: "GET" });
    if (!resp.ok) {
      const errBody = await resp.text();
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          error: "api_error", status: resp.status, body: errBody,
        }) }],
        isError: true,
      };
    }
    const json = await resp.json();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(json) }],
      structuredContent: json,
    };
  },
};
```

Registered in `mcp-ts/src/server.ts` alongside existing tools:
```typescript
import { verifyAlertTool } from "@/tools/verify-alert";
mcp.registerTool(
  verifyAlertTool.name,
  {
    description: verifyAlertTool.description,
    inputSchema: verifyAlertTool.inputSchema,
    annotations: verifyAlertTool.annotations,
  },
  withMetrics(verifyAlertTool.name, verifyAlertTool.handler),
);
```

**Free tier**: no x402 payment required. Receipt data is public via web/API anyway; charging for proxy access would discourage agent adoption.

---

## 2. Telegram bot — 5 templates × 2 languages

File: `bot-ts/locales/en.ftl` and `bot-ts/locales/pt-BR.ftl`.

Each of 5 alert templates (`alert_lst`, `alert_cdp`, `alert_fx`, `alert_yield`, `alert_stable`) gets one new line at the end of the body:

**en.ftl**:
```
🔍 <a href="{ $evidenceUrl }">Evidence (audit { $alertId })</a>
```

**pt-BR.ftl**:
```
🔍 <a href="{ $evidenceUrl }">Evidência (audit { $alertId })</a>
```

`{ $alertId }` renders the UUID for legibility — the anchor text gives the reader a sense of "this is a specific receipt", not just a generic link.

**Telegram message length**: existing templates ~400 chars. New line adds ~80 chars. Total ~480 — well under Telegram's 4096-char limit.

**HTML mode**: existing templates use `parse_mode: "HTML"`. New `<a>` tag works natively.

**No Zod schema change needed in bot**: `bot-ts/src/index.ts:1113` Zod schema is `vars: z.record(z.string(), z.unknown()).default({})` — already accepts arbitrary keys. `evidenceUrl` and `alertId` flow through unchanged.

---

## 3. Dispatcher — propagate evidence URL

File: `crates/dispatcher-rs/src/format.rs::build_send_payload`.

**Signature change** (one new parameter):
```rust
pub fn build_send_payload(
    chat_id: i64,
    locale: &str,
    event: &AlertEvent,
    audit_base_url: &str,    // NEW
) -> Value {
    let template = /* existing */;
    json!({
        "chatId": chat_id,
        "template": template,
        "locale": locale,
        "idempotencyKey": format!("alert:{}", event.id),
        "vars": {
            "asset": event.asset,
            "class": class_label(event.class),
            "fromState": label(event.from_state),
            "toState": label(event.to_state),
            "discount": event.discount,
            "intrinsicUsd": event.intrinsic_usd,
            "marketUsd": event.market_usd,
            "extra": event.extra,
            "detectedAt": event.detected_at,
            "alertId": event.id,                                              // NEW
            "evidenceUrl": format!("{}/audit/{}", audit_base_url, event.id),  // NEW
        }
    })
}
```

**`DispatchConfig`** (in `crates/dispatcher-rs/src/webhook.rs`) gets new field:
```rust
pub struct DispatchConfig {
    // ... existing fields ...
    pub audit_base_url: String,
}
```

Loaded once at startup from env:
```rust
let audit_base_url = pegana_common::audit_base_url();  // defaults to "https://pegana.xyz"
```

**Caller updates**: every `build_send_payload(chat, locale, event)` call site adds `&config.audit_base_url`. Search and update.

---

## 4. Webhook payload — `evidence_url` field

File: `crates/dispatcher-rs/src/webhook.rs`.

Wherever the webhook JSON body is constructed, add `evidence_url`:

```rust
let body = serde_json::json!({
    "id": event.id,
    "asset": event.asset,
    "class": asset_class_label(event.class),
    "from_state": peg_state_label(event.from_state),
    "to_state": peg_state_label(event.to_state),
    "discount": event.discount,
    "intrinsic_usd": event.intrinsic_usd,
    "market_usd": event.market_usd,
    "detected_at": event.detected_at,
    "evidence_url": format!("{}/audit/{}", config.audit_base_url, event.id),  // NEW
    // ... any other existing fields ...
});
```

**HMAC ed25519 signing**: already covers the full body via `pegana_common::webhook_sign::sign_payload`. New field is automatically included in signature. Receivers verify signature → entire body integrity is preserved. **No breaking change for existing subscribers** (additive field — old code ignores unknown JSON keys).

**Test update** (`crates/dispatcher-rs/tests/webhook_signing.rs`): assert that `evidence_url` is in the signed body. Update fixtures to pass `audit_base_url = "https://pegana.test"`.

---

## 5. Embed widget — script + iframe

### Script variant: `web/public/embed.js`

Lightweight (~6 KB minified+gzipped), no external deps, polls `/v1/assets/<symbol>` every 30s, renders a 240×40 badge inline.

```javascript
(function () {
  "use strict";
  const API = "https://api.pegana.xyz";
  const SITE = "https://pegana.xyz";
  const COLORS = {
    PEGGED: "#10b981", DRIFT: "#eab308", DEPEG: "#f97316",
    CRITICAL: "#dc2626", BLACK_SWAN: "#7c2d12", UNKNOWN: "#71717a",
  };

  function renderBadge(target, asset, state, theme) {
    const dark = theme === "dark";
    target.innerHTML = `
      <a href="${SITE}/audit?asset=${asset}" target="_blank" rel="noopener" style="
        display: inline-flex; align-items: center; gap: 8px;
        padding: 6px 12px; border-radius: 6px;
        background: ${dark ? "#0a0a0a" : "#ffffff"};
        color: ${dark ? "#fafafa" : "#0a0a0a"};
        border: 1px solid ${dark ? "#3f3f46" : "#e4e4e7"};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px; text-decoration: none;
      ">
        <span style="font-weight: 600;">${asset}</span>
        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%;
                     background: ${COLORS[state] || COLORS.UNKNOWN};"></span>
        <span>${state}</span>
        <span style="color: ${dark ? "#a1a1aa" : "#71717a"}; font-size: 11px;">Pegana ↗</span>
      </a>
    `;
  }

  async function fetchState(asset) {
    try {
      const resp = await fetch(`${API}/v1/assets/${asset}`);
      if (!resp.ok) return "UNKNOWN";
      const data = await resp.json();
      return data.state || "UNKNOWN";
    } catch { return "UNKNOWN"; }
  }

  async function update(target) {
    const asset = target.getAttribute("data-pegana-asset");
    const theme = target.getAttribute("data-pegana-theme") || "light";
    const state = await fetchState(asset);
    renderBadge(target, asset, state, theme);
    window.postMessage({ type: "pegana:state", asset, state }, "*");
  }

  function init() {
    document.querySelectorAll("[data-pegana-asset]").forEach((t) => {
      update(t);
      setInterval(() => update(t), 30000);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
})();
```

Partner integration:
```html
<div data-pegana-asset="USDe"></div>
<script async src="https://pegana.xyz/embed.js"></script>
```

### Iframe variant: `web/app/embed/[asset]/page.tsx`

Server-rendered Next.js page. Same visual as script badge. Sandboxed by browser — host site has zero JS access.

```tsx
const API_BASE = process.env.PEGANA_API ?? "https://api.pegana.xyz";
export const dynamic = "force-dynamic";

const COLORS: Record<string, string> = {
  PEGGED: "#10b981", DRIFT: "#eab308", DEPEG: "#f97316",
  CRITICAL: "#dc2626", BLACK_SWAN: "#7c2d12", UNKNOWN: "#71717a",
};

export default async function EmbedPage({
  params, searchParams,
}: {
  params: Promise<{ asset: string }>;
  searchParams: Promise<{ theme?: string }>;
}) {
  const { asset } = await params;
  const { theme } = await searchParams;
  const dark = theme === "dark";
  const data = await fetch(`${API_BASE}/v1/assets/${asset}`)
    .then((r) => (r.ok ? r.json() : { state: "UNKNOWN" }))
    .catch(() => ({ state: "UNKNOWN" }));

  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      padding: "6px 12px", borderRadius: 6,
      background: dark ? "#0a0a0a" : "#ffffff",
      color: dark ? "#fafafa" : "#0a0a0a",
      border: `1px solid ${dark ? "#3f3f46" : "#e4e4e7"}`,
      fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      fontSize: 13,
    }}>
      <span style={{ fontWeight: 600 }}>{asset}</span>
      <span style={{
        display: "inline-block", width: 8, height: 8, borderRadius: "50%",
        background: COLORS[data.state] || COLORS.UNKNOWN,
      }} />
      <span>{data.state}</span>
      <a href={`https://pegana.xyz/audit?asset=${asset}`} target="_blank" rel="noopener"
         style={{ color: dark ? "#a1a1aa" : "#71717a", fontSize: 11, textDecoration: "none" }}>
        Pegana ↗
      </a>
    </div>
  );
}
```

Partner integration:
```html
<iframe src="https://pegana.xyz/embed/USDe" width="240" height="48" frameborder="0"></iframe>
```

### Demo: `web/app/embed/demo/page.tsx`

Shows both variants live + copy-paste snippets. Targets: protocol engineers wanting to integrate.

---

## 6. CORS for embed widget

Already covered in `07-api-surface.md § CORS configuration`. Scoped to `/v1/assets/*` only (read-only). Audit endpoints remain same-origin.

---

## 7. Test plan

| Test | Where | Scenario |
|---|---|---|
| MCP `verify_alert` returns 200 receipt | `mcp-ts/test/tools/verify-alert.test.ts` (new) | Synthetic alert UUID in test DB |
| MCP `verify_alert` returns 404 cleanly | same | unknown UUID — isError true |
| MCP `subscribe_peg_events` includes `evidence_url` | `mcp-ts/test/tools/subscribe-peg-events.test.ts` | seed alert+evidence, verify field present |
| Bot template renders evidence link in EN | `bot-ts/test/locale.test.ts` (new) | Fluent rendering of `alert_lst` with vars |
| Bot template renders evidence link in PT-BR | same | same for pt-BR |
| Webhook payload includes signed evidence_url | `crates/dispatcher-rs/tests/webhook_signing.rs` (existing test extended) | Verify ed25519 signature covers body with new field |
| Embed iframe renders DRIFT badge correctly | manual visual test or Playwright | Visit `/embed/USDe` |
| Embed script polls API every 30s | manual or Cypress | Inspect Network tab, confirm cadence |
| Embed `postMessage` fires on state | Cypress | Listen on parent window for `pegana:state` |

---

## 8. Cross-references

- For backend API endpoints these surfaces consume, see `07-api-surface.md`.
- For web pages (`/audit`, `/embed/demo`), see `09-web-pages.md`.
- For dispatcher event-fan-out architecture, see `02-architecture.md § Data flow`.
- For tasks, see `plans/06-phase-5-dispatcher.md`, `plans/07-phase-6-7-bot-mcp.md`, `plans/11-phase-11M-maximalist.md § 11M.3`.
- For acceptance criteria AC26-AC30, AC51-AC55, see `12-acceptance-criteria.md`.
