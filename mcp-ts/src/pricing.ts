// Every MCP tool is free.
//
// Pegana is fully open and free, so there is no payment tier: no tool is
// wrapped in an x402 payment requirement, and nothing is charged. This module
// remains the single source of truth for what the discovery surfaces advertise,
// so a future paid tier (or a mirror deployment) changes one file rather than
// three.
//
// `price` is kept on every entry, explicitly `"free"`, because machine readers
// (/ .well-known/mcp.json, the landing page) need a price field and an absent
// field reads as "unknown" rather than "no charge".

/** The price shown for a tool that is not metered. */
export const FREE_PRICE = "free";

export interface ToolCatalogEntry {
  readonly name: string;
  /** Always `"free"` today. */
  readonly price: string;
  /** One line, for machine-readable discovery surfaces. */
  readonly description: string;
}

/**
 * Every tool the server registers, with its price.
 *
 * This is where free tools are advertised: Bazaar discovery rides on the 402
 * challenge, and a free tool never issues one, so the manifest is the surface
 * an agent can read before calling anything.
 */
export const TOOL_CATALOG: readonly ToolCatalogEntry[] = [
  {
    name: "ping",
    price: FREE_PRICE,
    description: "Liveness probe; returns pong and server uptime.",
  },
  {
    name: "get_assets",
    price: FREE_PRICE,
    description: "List every tracked asset with its current peg state.",
  },
  {
    name: "get_asset_state",
    price: FREE_PRICE,
    description: "Current intrinsic-vs-market state for one asset.",
  },
  {
    name: "get_loop_exposure",
    price: FREE_PRICE,
    description: "Cross-protocol leverage exposure for one asset (advisory).",
  },
  {
    name: "simulate_depeg_impact",
    price: FREE_PRICE,
    description: "Depeg liquidation-cascade estimate on a preset shock grid.",
  },
  {
    name: "get_methodology",
    price: FREE_PRICE,
    description: "Per-class peg-mechanism and scoring methodology.",
  },
  {
    name: "verify_alert",
    price: FREE_PRICE,
    description: "Fetch a public audit receipt by alert UUID.",
  },
  {
    name: "ping_paid",
    price: FREE_PRICE,
    description: "Liveness probe that also exercises the MCP call path.",
  },
  {
    name: "get_asset_history",
    price: FREE_PRICE,
    description: "Bucketed discount time-series, up to 50k rows.",
  },
  {
    name: "subscribe_peg_events",
    price: FREE_PRICE,
    description: "Peg state-transition events with a lossless cursor.",
  },
] as const;

/** `"10 free"`, derived rather than written by hand. */
export function toolCountSummary(): string {
  return `${TOOL_CATALOG.length} free`;
}
