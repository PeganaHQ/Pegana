"use client";

import { useLive } from "@/lib/store/live-context";

// Per-tab REST polling budget. The public API allows a fixed number of
// requests a minute per IP, shared by every tab and every visitor behind the
// same NAT, so each key polls only as fast as its data actually needs.
//
// While the WebSocket is up it already pushes each asset's state, spread and
// prices, so REST only refreshes the slower fields the socket does not carry
// (24h series, band, counters, receipts). Peg-state transitions over the
// socket also trigger a stats + receipts refresh (lib/store/live-context.tsx),
// so those can poll slowly too.
//
// Idle budget per visible tab on /dashboard (assets + stats + alerts):
//   socket up:   1/5 + 1/2 + 1/2 = 1.2 req/min
//   socket down: 2   + 1   + 1   = 4   req/min
// Hidden tabs do not poll at all (SWR `refreshWhenHidden` is false).
export type PollKind = "assets" | "stats" | "alerts";

const INTERVALS: Record<
  PollKind,
  { noSocket: number; socketUp: number; socketDown: number }
> = {
  // noSocket: a page outside the app shell (marketing) never opens a socket.
  assets: { noSocket: 60_000, socketUp: 300_000, socketDown: 30_000 },
  stats: { noSocket: 60_000, socketUp: 120_000, socketDown: 60_000 },
  alerts: { noSocket: 60_000, socketUp: 120_000, socketDown: 60_000 },
};

export function pollIntervalMs(
  kind: PollKind,
  live: { available?: boolean; connected?: boolean },
): number {
  const i = INTERVALS[kind];
  if (!live.available) return i.noSocket;
  return live.connected ? i.socketUp : i.socketDown;
}

export function usePollInterval(kind: PollKind): number {
  return pollIntervalMs(kind, useLive());
}
