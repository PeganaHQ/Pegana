> ⚠️ **AMENDED** — see [`../AMENDMENTS.md`](../AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original plan preserved below as historical reference.

---

# Phase 6+7 — Bot Localization + MCP Tools

**Spec reference**: `../08-external-surfaces.md § Telegram bot` + `§ MCP`
**Acceptance criteria covered**: AC26 (bot locales), AC28 (subscribe_peg_events), AC29 (verify_alert), AC30 (backward compat)
**Dependencies**: Phase 5 (dispatcher already sends `evidenceUrl` + `alertId`)
**Estimated duration**: 0.5 day

---

## Task 6.1 — en.ftl: add evidence line to 5 alert templates

**Files**: `bot-ts/locales/en.ftl`

- [ ] **Step 1**: Locate the 5 alert templates

Open `bot-ts/locales/en.ftl`. Search for each:
- `alert_lst`
- `alert_cdp`
- `alert_fx`
- `alert_yield`
- `alert_stable`

- [ ] **Step 2**: Append evidence line to each template body

To EACH of the 5 templates, append a final line (indented with 4 spaces to match Fluent multi-line body convention):

```
    🔍 <a href="{ $evidenceUrl }">Evidence (audit { $alertId })</a>
```

Example (`alert_lst` before):

```
alert_lst =
    🚨 <b>{ $asset }</b> · LST drift detected

    State: <code>{ $fromState }</code> → <code>{ $toState }</code>
    Discount: { $discount }
```

After:

```
alert_lst =
    🚨 <b>{ $asset }</b> · LST drift detected

    State: <code>{ $fromState }</code> → <code>{ $toState }</code>
    Discount: { $discount }
    🔍 <a href="{ $evidenceUrl }">Evidence (audit { $alertId })</a>
```

- [ ] **Step 3**: Verify Fluent parses

```bash
cd bot-ts && bun test
```

Expected: existing tests pass. Fluent will silently ignore unused variables, so no test for the new line specifically — verified end-to-end by manual smoke test in staging.

- [ ] **Step 4**: Commit

```bash
git add bot-ts/locales/en.ftl
git commit -m "$(cat <<'EOF'
i18n(bot): add 🔍 Evidence link to 5 alert templates (EN)

Each of alert_lst, alert_cdp, alert_fx, alert_yield, alert_stable gets
a final line with <a href="{$evidenceUrl}">Evidence (audit {$alertId})</a>.
Telegram HTML parse_mode renders the anchor inline.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6.2 — pt-BR.ftl: same localized

**Files**: `bot-ts/locales/pt-BR.ftl`

- [ ] **Step 1**: Append localized evidence line

For each of the 5 alert templates, append:

```
    🔍 <a href="{ $evidenceUrl }">Evidência (audit { $alertId })</a>
```

(Only difference vs EN: "Evidence" → "Evidência")

- [ ] **Step 2**: Verify + commit

```bash
cd bot-ts && bun test
git add bot-ts/locales/pt-BR.ftl
git commit -m "i18n(bot): add 🔍 Evidência link to 5 alert templates (PT-BR)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7.1 — MCP `subscribe_peg_events` returns evidence_url per event

**Files**: `mcp-ts/src/tools/subscribe-peg-events.ts`

- [ ] **Step 1**: Extend Zod `alertEvent` schema

In `mcp-ts/src/tools/subscribe-peg-events.ts`, locate `alertEvent` (around line 23):

```typescript
const alertEvent = z.object({
  id: z.string(),
  asset: z.string(),
  from_state: z.enum(PEG_STATES),
  to_state: z.enum(PEG_STATES),
  discount: z.string().describe("Signed decimal at the moment of state transition."),
  ts: z.number().int().describe("Unix seconds of the transition."),
  evidence_url: z.string().url().describe(    // NEW
    "Public URL of the alert's audit receipt — inputs, methodology version, replay bundle download."
  ),
});
```

- [ ] **Step 2**: Build `evidence_url` per event in handler

Replace the events mapping in the handler:

```typescript
async handler(args: { symbols: string[]; since_ts: number; threshold_bps?: number }) {
  const minBps = args.threshold_bps ?? 0;
  const auditBase = process.env.AUDIT_BASE_URL ?? "https://pegana.xyz";   // NEW
  const result = await pool().query<{
    id: string; asset: string;
    from_state: string; to_state: string;
    discount: string; ts: number;
  }>(
    `SELECT id, asset, from_state, to_state,
            discount::text,
            EXTRACT(EPOCH FROM ts)::int AS ts
     FROM alert_events
     WHERE asset = ANY($1)
       AND ts > to_timestamp($2)
       AND ABS(discount * 10000) >= $3
     ORDER BY ts ASC
     LIMIT 1000`,
    [args.symbols, args.since_ts, minBps],
  );
  const events = result.rows.map((r) => ({
    ...r,
    from_state: normalizePegState(r.from_state),
    to_state: normalizePegState(r.to_state),
    evidence_url: `${auditBase}/audit/${r.id}`,   // NEW
  }));
  const nextCursor = events.length > 0 ? events[events.length - 1]!.ts : args.since_ts;
  const structured = {
    count: events.length,
    next_cursor: nextCursor,
    events,
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structured) }],
    structuredContent: structured,
  };
},
```

- [ ] **Step 3**: Update tool `description` field to mention `evidence_url`

Append to the description:

```
" Each event includes evidence_url — a public link to the alert's audit receipt for verification."
```

- [ ] **Step 4**: Verify + test

```bash
cd mcp-ts && bunx tsc --noEmit && bun test
```

Expected: typecheck clean, existing tests pass.

- [ ] **Step 5**: Commit

```bash
git add mcp-ts/src/tools/subscribe-peg-events.ts
git commit -m "$(cat <<'EOF'
feat(mcp): subscribe_peg_events returns evidence_url per event

Both content (text JSON) AND structuredContent updated. Zod alertEvent
schema extended (z.string().url()). Agents follow the link to verify
the receipt or download replay bundle. Backward compatible — old
clients ignore unknown field.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7.2 — New MCP tool: verify_alert

**Files**:
- Create: `mcp-ts/src/tools/verify-alert.ts`
- Modify: `mcp-ts/src/server.ts` (registration)

- [ ] **Step 1**: Write the tool

Write `mcp-ts/src/tools/verify-alert.ts`:

```typescript
// Free tool — proxy to GET /v1/audit/:alert_id.
// No x402 payment required; receipt data is public via web/API anyway.

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
    alert_id: z
      .string()
      .uuid()
      .describe(
        "Alert UUID (from subscribe_peg_events.id or the last segment of /audit/<id>).",
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
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: "api_error",
              status: resp.status,
              body: errBody,
            }),
          },
        ],
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

- [ ] **Step 2**: Register in server.ts

In `mcp-ts/src/server.ts`, locate the existing tool registration block (around line 106-160). Add:

```typescript
import { verifyAlertTool } from "@/tools/verify-alert";

// ... inside the registration code ...
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

- [ ] **Step 3**: Verify + test

```bash
cd mcp-ts && bunx tsc --noEmit && bun test
```

Expected: clean.

- [ ] **Step 4**: Commit

```bash
git add mcp-ts/src/tools/verify-alert.ts mcp-ts/src/server.ts
git commit -m "$(cat <<'EOF'
feat(mcp): new verify_alert tool — proxy to /v1/audit/:alert_id

Free tool (no x402). Agents call after subscribe_peg_events to inspect
any alert's methodology version, frozen inputs, computed outputs, and
on-chain commitment. Backward compatible with MCP spec — uses canonical
content + structuredContent shape.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Acceptance verification for Phases 6+7

- [ ] AC26 — Telegram alerts in PT-BR and EN include `🔍 Evidence: <link>` line for all 5 templates (smoke test on staging with synthetic alert dispatch)
- [ ] AC28 — `subscribe_peg_events` returns `evidence_url` in both `content` text and `structuredContent`; Zod schema includes `z.string().url()`
- [ ] AC29 — New `verify_alert` tool registered, returns receipt JSON, free tier (no x402 wrapper)
- [ ] AC30 — Backward compat: MCP test with old client schemas (without `evidence_url`) succeeds — additive field validated

---

## Cross-references

- For full external surfaces spec, see `../08-external-surfaces.md`.
- For Phase 5 dispatcher providing `evidenceUrl` to bot, see `06-phase-5-dispatcher.md`.
- For the API endpoint consumed by `verify_alert`, see `05-phase-4-api.md`.
