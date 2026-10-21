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
import { normalizeDecimal } from "@/shared/decimal";
import { symbolSchema } from "@/shared/symbol";
import {
  isNonPublicSymbol,
  missingSnapshotMessage,
  registryEntry,
} from "@/shared/asset-registry";

const PEG_STATES = [
  "PEGGED",
  "DRIFT",
  "DEPEG",
  "CRITICAL",
  "BLACK_SWAN",
  "UNKNOWN",
] as const;

// Upper bound for the cursor: 10^10 s is the year 2286. Keeps an absurd value
// (1e300 used to reach Postgres and come back as the raw "timestamp out of
// range" error, R2 audit idx 21) and a milliseconds-instead-of-seconds mix-up
// at the schema boundary.
const MAX_SINCE_TS = 10_000_000_000;

const EVIDENCE_STATUSES = ["ready", "pending", "failed_permanent", "missing"] as const;
type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

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
      "Unix timestamp of the transition (fractional seconds, lossless, so `next_cursor` round-trips gap-free).",
    ),
  evidence_url: z
    .string()
    .url()
    .describe(
      "Public URL of the alert's audit page. When `evidence_status` is `ready` it shows the receipt (inputs frozen, methodology version, computed outputs, replay bundle download); otherwise it reports the receipt as pending, failed or missing.",
    ),
  evidence_status: z
    .enum(EVIDENCE_STATUSES)
    .optional()
    .describe(
      "Receipt state, same values as `verify_alert`'s `evidence_status` plus `missing`: `ready` = verifiable receipt exists; `pending` = still being persisted; `failed_permanent` = persistence failed and the receipt will never exist; `missing` = no persisted receipt for this alert (some alerts have none; a just-created alert can show `missing` for a moment before its receipt lands), so `verify_alert` returns `evidence_missing`. Absent when this server cannot read receipt state.",
    ),
});

type PegEventsPool = {
  query<T>(sql: string, params: unknown[]): Promise<{ rows: T[] }>;
};

// node-postgres hands NUMERIC back as a string; `ts` is cast to float8 in
// SQL (parsed to a JS number by pg) and coerced again in the row map, so a
// driver or query change can never put a string on the wire again.
type AlertEventRow = {
  id: string;
  asset: string;
  from_state: string;
  to_state: string;
  discount: string;
  ts: number | string;
  evidence_status?: string;
};

// Receipt state per event, from the same tables /v1/audit/{id} reads
// (crates/api-rs/src/routes/audit.rs): alert_evidence = ready; a pending row
// is pending, or failed_permanent once failed_permanently_at is set; neither
// = missing (the 404 evidence_missing case, R2 audit idx 22). Both lookups are
// primary-key probes on alert_id.
const EVIDENCE_STATUS_SQL = `CASE
              WHEN EXISTS (SELECT 1 FROM alert_evidence ae WHERE ae.alert_id = alert_events.id) THEN 'ready'
              WHEN EXISTS (SELECT 1 FROM alert_evidence_pending p WHERE p.alert_id = alert_events.id AND p.failed_permanently_at IS NOT NULL) THEN 'failed_permanent'
              WHEN EXISTS (SELECT 1 FROM alert_evidence_pending p WHERE p.alert_id = alert_events.id) THEN 'pending'
              ELSE 'missing'
            END AS evidence_status,`;

// Set once the DB role turns out to lack SELECT on the receipt tables
// (Postgres 42501, e.g. a least-privilege pegana_mcp login without the grant):
// events are then served without evidence_status rather than failing.
let receiptStateUnreadable = false;

function isInsufficientPrivilege(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === "42501";
}

function eventsSql(withEvidenceStatus: boolean): string {
  // `ts` is the LOSSLESS fractional-seconds epoch (NOT ::int) so the cursor
  // round-trip is gap-free: rounding to whole seconds dropped events past a
  // second boundary or re-returned events within the same second (T7 audit).
  // The `::float8` cast on the cursor keeps the comparison in the same domain.
  // EXTRACT returns NUMERIC on PG14+, which node-pg returns as a STRING; the
  // explicit `::float8` makes pg parse it to a JS number. A double holds an
  // epoch with microsecond resolution (ulp ~0.24us at 1.8e9 s), so
  // to_timestamp(next_cursor) round-trips to the exact stored microsecond.
  return `SELECT id::text AS id, asset, from_state::text AS from_state,
            to_state::text AS to_state,
            discount::text AS discount,
            ${withEvidenceStatus ? EVIDENCE_STATUS_SQL : ""}
            EXTRACT(EPOCH FROM ts)::float8 AS ts
     FROM alert_events
     WHERE asset = ANY($1)
       AND ts > to_timestamp($2::float8)
       AND ABS(discount * 10000) >= $3
     ORDER BY ts ASC
     LIMIT 1000`;
}

function evidenceStatusOf(v: string | undefined): EvidenceStatus | undefined {
  return (EVIDENCE_STATUSES as readonly string[]).includes(v ?? "")
    ? (v as EvidenceStatus)
    : undefined;
}

/**
 * "not tracked" error naming every unknown symbol, worded like the other
 * tools (missingSnapshotMessage) so agents can match one phrase.
 */
function unknownSymbolsMessage(symbols: string[]): string {
  if (symbols.length === 1) return missingSnapshotMessage(symbols[0]!, "events");
  const list = symbols.map((s) => `'${s}'`).join(", ");
  return `Error: assets ${list} not tracked. Use get_assets() to list tracked symbols.`;
}

/** Test seam: reset the privilege fallback between cases. */
export function __resetReceiptStateForTests(): void {
  receiptStateUnreadable = false;
}

export const subscribePegEventsTool = {
  name: "subscribe_peg_events",
  description:
    "Free. Returns a batch of peg state-transition events for the requested " +
    "symbols since the `since_ts` cursor. `structuredContent` is `{ count, next_cursor, events: [{ id, asset, from_state, to_state, discount, ts, evidence_url, evidence_status? }, ...] }`; " +
    "states are `PEGGED | DRIFT | DEPEG | CRITICAL | BLACK_SWAN | UNKNOWN`; `discount` is a signed decimal string; `ts` is unix seconds. " +
    "Up to 1000 events per call, ordered ascending by `ts`. " +
    "Polling pattern: call with `since_ts = next_cursor` on each subsequent call to walk the stream without gaps. " +
    'Example: `{ symbols: ["jitoSOL", "USDe"], since_ts: 0, threshold_bps: 25 }` → all state transitions for jitoSOL or USDe where |discount| ≥ 25bps. ' +
    "Use this for alerting agents, peg-aware trading bots, or post-incident review. " +
    "Returns `isError: true` naming the symbol(s) if any requested symbol is not tracked (symbols are case-sensitive; call `get_assets` to enumerate them). " +
    "Each event includes `evidence_url`, the public audit page for the alert, and `evidence_status`: only `ready` events have a verifiable receipt (some alerts have no persisted receipt, `missing`; a just-created alert can show `missing` for a moment before its receipt lands).",
  inputSchema: {
    symbols: z
      .array(symbolSchema())
      .min(1)
      .max(20)
      .describe(
        "Array of 1–20 asset symbols to subscribe to. Symbols are case-sensitive and use the same set as `get_asset_state`.",
      ),
    since_ts: z
      .number()
      .finite()
      .min(0, { message: "since_ts must be a unix timestamp in seconds, >= 0" })
      .max(MAX_SINCE_TS, {
        message: `since_ts must be a unix timestamp in SECONDS (<= ${MAX_SINCE_TS}); milliseconds are not accepted`,
      })
      .describe(
        "Cursor: return events strictly after this unix timestamp (fractional seconds OK; the cursor is lossless). Must be >= 0 and in seconds (not milliseconds). Pass `0` on the first call to fetch backlog; on subsequent calls pass `next_cursor` from the previous response verbatim.",
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
        "Pass this back as `since_ts` on the next call (lossless fractional-seconds cursor: walk the stream without gaps or duplicates). Equals the `ts` of the most recent event, or the input `since_ts` when the batch is empty.",
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
  // The MCP SDK passes RequestHandlerExtra as the 2nd argument; the handler's
  // 2nd parameter is a test seam, so never forward it.
  handler: (args: { symbols: string[]; since_ts: number; threshold_bps?: number }) => {
    // Off-surface classes (xSOL) are not tracked publicly; REST answers 404 and
    // the other tools say "not tracked". Same answer here.
    const hidden = args.symbols.find((s) => isNonPublicSymbol(s));
    if (hidden !== undefined) {
      return Promise.resolve({
        content: [{ type: "text" as const, text: missingSnapshotMessage(hidden, "events") }],
        isError: true as const,
      });
    }
    return handleSubscribePegEvents(args);
  },
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
  const params = [args.symbols, args.since_ts, minBps];
  let result: { rows: AlertEventRow[] };
  if (receiptStateUnreadable) {
    result = await eventsPool.query<AlertEventRow>(eventsSql(false), params);
  } else {
    try {
      result = await eventsPool.query<AlertEventRow>(eventsSql(true), params);
    } catch (e) {
      if (!isInsufficientPrivilege(e)) throw e;
      receiptStateUnreadable = true;
      result = await eventsPool.query<AlertEventRow>(eventsSql(false), params);
    }
  }
  // R3 audit R3-MCP-03: an unknown or mistyped symbol used to return success
  // with zero events, indistinguishable from "no transitions yet". Same rule
  // as get_asset_history: a symbol is unknown when this build's registry does
  // not list it AND the query returned no row for it (an asset added after
  // this build still has rows, so a registry miss alone is not enough).
  const seen = new Set(result.rows.map((r) => r.asset));
  const unknown = [...new Set(args.symbols)].filter(
    (s) => !registryEntry(s) && !seen.has(s),
  );
  if (unknown.length > 0) {
    return {
      content: [{ type: "text" as const, text: unknownSymbolsMessage(unknown) }],
      isError: true as const,
    };
  }
  // Defence in depth: never emit rows for an off-surface asset (xSOL), even if
  // the symbol filter is ever widened or dropped.
  const events = result.rows.filter((r) => !isNonPublicSymbol(r.asset)).map((r) => ({
    id: r.id,
    asset: r.asset,
    from_state: normalizePegState(r.from_state),
    to_state: normalizePegState(r.to_state),
    // Trailing zeros stripped like REST (the column is NUMERIC(10,6)).
    discount: normalizeDecimal(r.discount),
    ts: Number(r.ts),
    evidence_url: `${auditBase}/audit/${r.id}`,
    ...(evidenceStatusOf(r.evidence_status)
      ? { evidence_status: evidenceStatusOf(r.evidence_status) }
      : {}),
  }));
  // Cursor from the RAW rows (before the xSOL filter): a page that is entirely
  // filtered out must still advance, or the caller re-reads it forever.
  const lastRaw = result.rows[result.rows.length - 1];
  const nextCursor = lastRaw ? Number(lastRaw.ts) : args.since_ts;
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
