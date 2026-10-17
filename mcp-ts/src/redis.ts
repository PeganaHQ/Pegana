// Redis client + subscriber wrappers.
//
// One connection for queries (rare — most reads come from the in-memory
// cache below). A second connection runs SUBSCRIBE on `pegana:discount`
// and keeps a per-asset cache warm so getAssetState / getAssets can
// answer in single-digit milliseconds without a round-trip.
//
// `subscribeAlerts` is exposed for tools (subscribePegEvents) and for
// E1 metrics that count incoming events.

import Redis from "ioredis";
import {
  CHANNELS,
  normalizeAlertEvent,
  normalizeDiscountSnapshot,
  type AlertEvent,
  type DiscountSnapshot,
} from "@/shared/types";

let _client: Redis | null = null;
let _subscriber: Redis | null = null;

export function client(): Redis {
  if (!_client) {
    _client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  }
  return _client;
}

function subscriber(): Redis {
  if (!_subscriber) {
    _subscriber = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  }
  return _subscriber;
}

// Per-asset cache, kept warm by the discount subscription.
const cache = new Map<string, DiscountSnapshot>();

let _warming = false;

export async function startCacheWarming(): Promise<void> {
  if (_warming) return;
  _warming = true;
  const sub = subscriber();
  await sub.subscribe(CHANNELS.DISCOUNT);
  sub.on("message", (channel, msg) => {
    if (channel !== CHANNELS.DISCOUNT) return;
    try {
      const parsed = JSON.parse(msg) as DiscountSnapshot & { kind?: string };
      // Engine publishes two kinds on this channel:
      //   { kind: "update", asset, state, discount, ... } — the real data
      //   { kind: "heartbeat", ts: ISO }                  — liveness ping
      // Heartbeats have no `asset`, so caching them creates a poisoned
      // entry under key `undefined` that breaks the get_assets schema
      // (asset[index].asset is required). Filter explicitly. Treat
      // missing `kind` as "update" for back-compat with the historical
      // payload shape that didn't include it.
      if (parsed.kind && parsed.kind !== "update") return;
      if (typeof parsed.asset !== "string" || parsed.asset.length === 0) return;
      const snap = normalizeDiscountSnapshot(parsed);
      cache.set(snap.asset, snap);
    } catch {
      // ignore malformed events — engine pushes valid JSON, but be
      // forgiving in case of partial publishes.
    }
  });
}

export function getCachedState(asset: string): DiscountSnapshot | undefined {
  return cache.get(asset);
}

export function getAllCachedStates(): DiscountSnapshot[] {
  return Array.from(cache.values());
}

// One-off subscription for tools that need raw alert stream access.
// Returns an unsubscribe function. Each call opens its own Redis
// connection — callers responsible for closing.
export async function subscribeAlerts(
  handler: (evt: AlertEvent) => void | Promise<void>,
): Promise<() => Promise<void>> {
  const sub = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  await sub.subscribe(CHANNELS.ALERTS);
  sub.on("message", async (channel, msg) => {
    if (channel !== CHANNELS.ALERTS) return;
    try {
      const evt = normalizeAlertEvent(JSON.parse(msg) as AlertEvent);
      await handler(evt);
    } catch {
      // ignore malformed
    }
  });
  return async () => {
    await sub.unsubscribe();
    sub.disconnect();
  };
}
