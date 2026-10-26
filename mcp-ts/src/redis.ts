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
  parseDiscountMessage,
  type AlertEvent,
  type DiscountSnapshot,
} from "@/shared/types";

/**
 * Every connection is built here. `enableReadyCheck: false` stops ioredis from
 * sending `INFO` to decide when the connection is ready, so the Redis ACL for
 * this service can drop +info (least privilege). Commands and SUBSCRIBE are
 * unaffected: ioredis then treats the connection as ready on connect.
 */
export function newRedis(): Redis {
  return new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    enableReadyCheck: false,
  });
}

let _client: Redis | null = null;
let _subscriber: Redis | null = null;

export function client(): Redis {
  if (!_client) {
    _client = newRedis();
  }
  return _client;
}

function subscriber(): Redis {
  if (!_subscriber) {
    _subscriber = newRedis();
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
    // Heartbeats, other kinds and incomplete payloads are dropped by
    // parseDiscountMessage (see @/shared/types).
    const snap = parseDiscountMessage(msg);
    if (snap) cache.set(snap.asset, snap);
  });
}

export function getCachedState(asset: string): DiscountSnapshot | undefined {
  return cache.get(asset);
}

export function getAllCachedStates(): DiscountSnapshot[] {
  return Array.from(cache.values());
}

/** Test seam: seed or clear the in-memory snapshot cache. */
export const __cacheForTests = cache;

// One-off subscription for tools that need raw alert stream access.
// Returns an unsubscribe function. Each call opens its own Redis
// connection — callers responsible for closing.
export async function subscribeAlerts(
  handler: (evt: AlertEvent) => void | Promise<void>,
): Promise<() => Promise<void>> {
  const sub = newRedis();
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
