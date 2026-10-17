// Free tool — proxy to GET /v1/audit/:alert_id.
//
// No x402 payment required: the receipt data is already public via the
// web/API audit page, so charging here would just add friction exactly
// where you want zero (the trust pitch is "anyone can verify"). Usage
// signal comes from mcp_call_log telemetry (ADR-0011) rather than
// on-chain settlement.
//
// Pricing may evolve per the ADR-0011 escape hatch: if free turns out
// to be unsustainable, this flips to $0.0001/call (10× cheaper than the
// paid tools) without any schema change.

import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

const API_BASE = process.env.PEGANA_API ?? "https://api.pegana.xyz";

// Mirrors the /v1/audit/:id ready-response shape (api-rs/src/routes/audit.rs).
// The nested JSONB fields (inputs_frozen, computed, replay_artifact) are typed
// as `z.record(z.unknown())` because their exact shape evolves with the
// methodology version — we don't want clients to fail validation on a new
// field the engine added. Top-level envelope fields stay tightly typed so
// agents can rely on `evidence_status` etc. without parsing strings.
const alertSchema = z.object({
  id: z.string(),
  asset: z.string(),
  class: z.string(),
  from_state: z.string(),
  to_state: z.string(),
  discount: z.string(),
  intrinsic_usd: z.string(),
  market_usd: z.string(),
  confidence: z.string(),
  detected_at: z.string(),
});

const evidenceSchema = z.object({
  methodology_version: z.string(),
  methodology_git_sha: z.string().nullable().optional(),
  assets_toml_sha256: z.string(),
  inputs_frozen: z.record(z.unknown()),
  computed: z.record(z.unknown()),
  has_replay_artifact: z.boolean(),
  receipt_sha256: z.string(),
  onchain_tx_sig: z.string().nullable().optional(),
  // On-chain anchor status — mirrors AuditEvidence.commit_status in
  // crates/api-rs/src/routes/audit.rs. Was omitted from this strict schema, so a
  // typed MCP client validating structuredContent dropped the one field that
  // says whether the receipt is `committed` vs `wallet_drained`/`retry_exhausted`
  // — central to the "verifiable receipt" claim (QA audit 2026-07-23).
  commit_status: z
    .enum([
      "not_applicable",
      "pending",
      "committed",
      "retry_exhausted",
      "wallet_drained",
    ])
    .nullable()
    .optional(),
  created_at: z.string(),
});

// Error envelope mirrored into structuredContent on the api_error path so
// MCP clients with structuredContent-aware UIs don't have to JSON.parse the
// text. Same shape on the happy path is impossible (it'd require optional-
// everywhere), so this is a discriminated union via `error`.
const errorSchema = z.object({
  error: z.literal("api_error"),
  status: z.number().int(),
  body: z.string(),
});

// Top-level outputSchema: a single union covering both the ready-receipt
// happy path and the api_error short-circuit. The structuredContent on
// pending/persistence-failed shapes (202/410) flows through `evidence` as
// `null`-able + `evidence_status` carrying the discriminator.
const readyResponseSchema = z.object({
  alert: alertSchema,
  evidence: evidenceSchema,
  evidence_status: z.literal("ready"),
});

const pendingResponseSchema = z.object({
  status: z.literal("pending"),
  alert_id: z.string(),
  alert_dispatched_at: z.string(),
  retry_after_seconds: z.number().int(),
  evidence_status: z.literal("pending"),
});

const failedResponseSchema = z.object({
  status: z.literal("persistence_failed"),
  alert_id: z.string(),
  alert_dispatched_at: z.string(),
  last_error: z.string().nullable().optional(),
  evidence_status: z.literal("failed_permanent"),
});

export const verifyAlertTool = {
  name: "verify_alert",
  description:
    "Free. Fetches the public audit receipt for a given alert UUID. Returns inputs frozen, " +
    "methodology version, computed outputs, replay bundle URL, receipt sha256, and on-chain " +
    "tx signature (if committed). Use after `subscribe_peg_events` to verify a specific alert, " +
    "or to investigate any alert URL the user shares. " +
    "Pricing may evolve — see ADR-0011 (10× cheaper than paid tools if it ever flips off free).",
  inputSchema: {
    alert_id: z
      .string()
      .uuid()
      .describe(
        "Alert UUID (from subscribe_peg_events.id or the last segment of /audit/<id>).",
      ),
  },
  // Declared on the registered tool so MCP clients know they can rely on
  // structuredContent (per the MCP spec, clients MAY ignore / warn about
  // structuredContent for tools without an outputSchema).
  //
  // The shape is a discriminated union over `evidence_status` — `ready`
  // returns the full receipt; `pending` and `failed_permanent` mirror the
  // ADR-0006 four-state /v1/audit/:id contract; the `api_error` branch is
  // populated on non-2xx API responses so callers always have a structured
  // handle on the failure mode without parsing the text payload.
  outputSchema: {
    result: z.union([
      readyResponseSchema,
      pendingResponseSchema,
      failedResponseSchema,
      errorSchema,
    ]),
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
      const errorPayload = {
        error: "api_error" as const,
        status: resp.status,
        body: errBody,
      };
      // Audit C P2 #11: also populate structuredContent on the error path
      // so MCP clients don't have to JSON.parse the text payload to
      // distinguish failure modes (404 vs 410 vs 5xx).
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(errorPayload),
          },
        ],
        structuredContent: { result: errorPayload },
        isError: true,
      };
    }
    const json = (await resp.json()) as Record<string, unknown>;
    return {
      content: [{ type: "text" as const, text: JSON.stringify(json) }],
      // Wrap under `result` so the outputSchema's top-level shape stays
      // closed (MCP recommends a single top-level key for unions).
      structuredContent: { result: json },
    };
  },
};
