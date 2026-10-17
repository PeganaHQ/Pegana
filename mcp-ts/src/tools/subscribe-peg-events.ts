// Free tool — batch of AlertEvents matching the requested symbols +
// threshold since `since_ts`.
//
// MCP tools are request/response, not streaming in the classic sense.
// This tool returns ONE batch (up to 1000 rows). For continuous polling
// the agent calls again with the new `since_ts` (cursor). True
// streaming via MCP resources is a v2.1+ consideration.

import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { pool } from "@/db";
import { normalizePegState } from "@/shared/types";

const PEG_STATES = [
  "PEGGED",
  "DRIFT",
  "DEPEG",
  "CRITICAL",
  "BLACK_SWAN",
  "UNKNOWN",
] as const;

const alertEvent = z.object({
  id: z.string(),
  asset: z.string(),
  from_state: z.enum(PEG_STATES),
  to_state: z.enum(PEG_STATES),
  discount: z
    .string()
    .describe("Signed decimal at the moment of state transition."),
  ts: z
    .number()
    .describe(
      "Unix timestamp of the transition (fractional seconds — lossless, so `next_cursor` round-trips gap-free).",
    ),
  evidence_url: z
    .string()
    .url()
    .describe(
      "Public URL of the alert's audit receipt — inputs frozen, methodology version, computed outputs, replay bundle download.",
    ),
});

type PegEventsPool = {
  query<T>(sql: string, params: unknown[]): Promise<{ rows: T[] }>;
};

type AlertEventRow = {
  id: string;
  asset: string;
  from_state: string;
  to_state: string;
  discount: string;
  ts: number;
};

export const subscribePegEventsTool = {
  name: "subscribe_peg_events",
  description:
    "Free. Returns a batch of peg state-transition events for the requested " +
    "symbols since the `since_ts` cursor. `structuredContent` is `{ count, next_cursor, events: [{ id, asset, from_state, to_state, discount, ts }, ...] }` — " +
    "states are `PEGGED | DRIFT | DEPEG | CRITICAL | BLACK_SWAN | UNKNOWN`; `discount` is a signed decimal string; `ts` is unix seconds. " +
    "Up to 1000 events per call, ordered ascending by `ts`. " +
    "Polling pattern: call with `since_ts = next_cursor` on each subsequent call to walk the stream without gaps. " +
    'Example: `{ symbols: ["jitoSOL", "USDe"], since_ts: 0, threshold_bps: 25 }` → all state transitions for jitoSOL or USDe where |discount| ≥ 25bps. ' +
    "Use this for alerting agents, peg-aware trading bots, or post-incident review. " +
    "Each event includes evidence_url — a public link to the alert's audit receipt for verification.",
  inputSchema: {
    symbols: z
      .array(z.string())
      .min(1)
      .max(20)
      .describe(
        "Array of 1–20 asset symbols to subscribe to. Symbols are case-sensitive and use the same set as `get_asset_state`.",
      ),
    since_ts: z
      .number()
      .describe(
        "Cursor: return events strictly after this unix timestamp (fractional seconds OK — the cursor is lossless). Pass `0` on the first call to fetch backlog; on subsequent calls pass `next_cursor` from the previous response verbatim.",
      ),
    threshold_bps: z
      .number()
      .int()
      .min(0)
      .max(10_000)
      .optional()
      .describe(
        "Optional minimum |discount| in basis points to include an event. e.g. `25` = only events where the asset moved at least 25bps (0.25%) off intrinsic. Default 0 (every state-transition).",
      ),
  },
  outputSchema: {
    count: z
      .number()
      .int()
      .nonnegative()
      .describe("Number of events returned (≤ 1000)."),
    next_cursor: z
      .number()
      .describe(
        "Pass this back as `since_ts` on the next call (lossless fractional-seconds cursor — walk the stream without gaps or duplicates). Equals the `ts` of the most recent event, or the input `since_ts` when the batch is empty.",
      ),
    events: z.array(alertEvent),
  },
  annotations: {
    title: "Pull peg state-transition events",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  } satisfies ToolAnnotations,
  handler: handleSubscribePegEvents,
};

export async function handleSubscribePegEvents(
  args: {
    symbols: string[];
    since_ts: number;
    threshold_bps?: number;
  },
  eventsPool: PegEventsPool = pool(),
) {
  const minBps = args.threshold_bps ?? 0;
  const auditBase = process.env.AUDIT_BASE_URL ?? "https://pegana.xyz";
  const result = await eventsPool.query<AlertEventRow>(
    // `ts` is the LOSSLESS fractional-seconds epoch (NOT ::int) so the cursor
    // round-trip is gap-free: rounding to whole seconds dropped events past a
    // second boundary or re-returned events within the same second (T7 audit).
    // The `::float8` cast on the cursor keeps the comparison in the same domain.
    `SELECT id, asset, from_state, to_state,
            discount::text,
            EXTRACT(EPOCH FROM ts) AS ts
     FROM alert_events
     WHERE asset = ANY($1)
       AND ts > to_timestamp($2::float8)
       AND ABS(discount * 10000) >= $3
     ORDER BY ts ASC
     LIMIT 1000`,
    [args.symbols, args.since_ts, minBps],
  );
  const events = result.rows.map((r) => ({
    ...r,
    from_state: normalizePegState(r.from_state),
    to_state: normalizePegState(r.to_state),
    evidence_url: `${auditBase}/audit/${r.id}`,
  }));
  const nextCursor =
    events.length > 0 ? events[events.length - 1]!.ts : args.since_ts;
  const structured = {
    count: events.length,
    next_cursor: nextCursor,
    events,
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structured) }],
    structuredContent: structured,
  };
}
