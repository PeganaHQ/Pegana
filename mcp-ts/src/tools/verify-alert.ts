// Free tool: proxy to GET /v1/audit/:alert_id.
//
// Free, like every tool: the receipt data is already public via the web/API
// audit page. Usage signal comes from mcp_call_log telemetry (ADR-0011).
//
// This is a FETCH, not a verification (R3 audit R3-MCP-05): no hash is
// recomputed and no on-chain anchor is checked here. Independent
// verification is the pegana-replay CLI (crates/pegana-replay-cli), and the
// description says so; keep it that way.

import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { retryAfterSeconds, upstreamGet } from "@/shared/upstream";

const API_BASE = process.env.PEGANA_API ?? "https://api.pegana.xyz";
// Links handed to agents must be publicly reachable, so they never use
// PEGANA_API (which may point at the internal docker network).
const PUBLIC_API_BASE =
  process.env.PEGANA_PUBLIC_API ?? "https://api.pegana.xyz";

// Mirrors the /v1/audit/:id ready-response shape (api-rs/src/routes/audit.rs).
// The nested JSONB fields (inputs_frozen, computed, replay_artifact) are typed
// as `z.record(z.string(), z.unknown())` because their exact shape evolves with the
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
  inputs_frozen: z.record(z.string(), z.unknown()),
  computed: z.record(z.string(), z.unknown()),
  has_replay_artifact: z.boolean(),
  replay_bundle_url: z
    .string()
    .url()
    .optional()
    .describe(
      "Public download URL of the replay bundle (GET /v1/audit/{id}/replay-bundle). Present only when has_replay_artifact is true.",
    ),
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
  retry_after_seconds: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("On a 429: seconds to wait before retrying, from the API's Retry-After."),
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
  evidence_status: z.literal("failed_permanent"),
});

/**
 * The api-rs `evidence_missing` 404 carries an operator hint ("... both
 * failed; check Sentry") meant for Pegana's on-call, not for agents (R2 audit
 * idx 22). Drop it and any internal last_error field from JSON error bodies.
 */
export function publicErrorBody(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return raw;
  const { hint: _internalHint, last_error: _internalError, ...publicFields } =
    parsed as Record<string, unknown>;
  return JSON.stringify(publicFields);
}

export const verifyAlertTool = {
  name: "verify_alert",
  description:
    "Free. Fetches the public audit receipt for a given alert UUID, exactly as Pegana's API serves it (a proxy of `GET /v1/audit/{id}`). Returns inputs frozen, " +
    "methodology version, computed outputs, `receipt_sha256`, the replay bundle download URL " +
    "(`evidence.replay_bundle_url`, when `has_replay_artifact` is true), the on-chain " +
    "tx signature (if committed) and `commit_status`. " +
    "This tool does NOT verify the receipt: it recomputes no hash and does not check the on-chain anchor, so what it returns is only as trustworthy as the server that served it. " +
    "For independent verification run the open-source `pegana-replay` CLI on your own machine (`cargo install pegana-replay --locked`, then `pegana-replay --alert-id <uuid>`): it re-hashes the frozen inputs and verdict, compares the result to `receipt_sha256`, and checks that the on-chain memo anchor carries that hash and was signed by Pegana's pinned ops wallet (`--offline` skips the on-chain check). " +
    "Use after `subscribe_peg_events` to fetch a specific alert's receipt, " +
    "or to investigate any alert URL the user shares. " +
    "Not every alert has a receipt: some alerts have no persisted receipt, and a just-created alert can lack one for a moment before its receipt lands. For those, this returns `isError: true` with `structuredContent.result` = `{ error: \"api_error\", status: 404, body }` where `body` carries `\"error\":\"evidence_missing\"` (check `subscribe_peg_events`' `evidence_status` first).",
  inputSchema: {
    // z.guid(): any 8-4-4-4-12 hex id, the permissive shape zod 3's uuid()
    // accepted. zod 4's uuid() additionally enforces RFC version/variant bits.
    alert_id: z
      .guid()
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
  async handler(args: { alert_id: string }, extra?: unknown) {
    const url = `${API_BASE}/v1/audit/${encodeURIComponent(args.alert_id)}`;
    const resp = await upstreamGet(url, extra);
    if (!resp.ok) {
      const errBody = publicErrorBody(await resp.text());
      const retry = resp.status === 429 ? retryAfterSeconds(resp) : undefined;
      const errorPayload = {
        error: "api_error" as const,
        status: resp.status,
        body: errBody,
        ...(retry !== undefined ? { retry_after_seconds: retry } : {}),
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
    if (json && typeof json === "object") delete json.last_error;
    const evidence = json.evidence as Record<string, unknown> | null | undefined;
    if (evidence && evidence.has_replay_artifact === true) {
      evidence.replay_bundle_url = `${PUBLIC_API_BASE}/v1/audit/${encodeURIComponent(args.alert_id)}/replay-bundle`;
    }
    return {
      content: [{ type: "text" as const, text: JSON.stringify(json) }],
      // Wrap under `result` so the outputSchema's top-level shape stays
      // closed (MCP recommends a single top-level key for unions).
      structuredContent: { result: json },
    };
  },
};
