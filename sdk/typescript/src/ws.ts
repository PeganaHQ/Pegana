// Live peg-feed WebSocket helper — completes the v0.2.0 SDK's coverage of the
// one endpoint OpenAPI can't model (the `/v1/ws` upgrade is only a stub in the
// spec). Typed to the server protocol in crates/api-rs/src/ws.rs.
//
// The server pushes `{op:"update", asset, payload}` discount updates (from Redis
// pub/sub) and `{op:"heartbeat", ts}` liveness frames; the client may send
// `{op:"subscribe"|"unsubscribe", assets:[...]}` to filter and `{op:"ping"}`
// (→ `{op:"pong"}`). A missing Origin header is allowed for server-to-server
// clients (browsers must present an allowlisted Origin), so this works from Node
// without any header wrangling.

const DEFAULT_WS_URL = "wss://api.pegana.xyz/v1/ws";

/** Frames the server pushes to the client. */
export type PegFeedServerMsg =
  | { op: "pong" }
  | { op: "error"; msg: string }
  | { op: "update"; asset: string; payload: Record<string, unknown> }
  | { op: "heartbeat"; ts: string };

/** Frames the client may send to the server. */
export type PegFeedClientMsg =
  | { op: "subscribe"; assets: string[] }
  | { op: "unsubscribe"; assets: string[] }
  | { op: "ping" };

/** Minimal structural shape of a WebSocket ctor — satisfied by the browser/Node
 *  global `WebSocket` and by the `ws` package's `WebSocket`. */
export type WebSocketLike = {
  new (url: string): {
    send(data: string): void;
    close(code?: number, reason?: string): void;
    onopen: ((ev: unknown) => void) | null;
    onmessage: ((ev: { data: unknown }) => void) | null;
    onerror: ((ev: unknown) => void) | null;
    onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  };
};

export interface PegFeedOptions {
  /** WebSocket URL. Defaults to the public hosted feed. */
  wsUrl?: string;
  /**
   * WebSocket implementation. Defaults to `globalThis.WebSocket` (present in
   * browsers and Node ≥ 22). On Node ≤ 21 pass the `ws` package's `WebSocket`.
   */
  WebSocketImpl?: WebSocketLike;
  /** Assets to subscribe to on open (e.g. ["USDC","JLP"]). Omit for all. */
  assets?: string[];
  /** Every decoded server frame (before the per-op callbacks below). */
  onMessage?: (msg: PegFeedServerMsg) => void;
  /** Convenience: only `update` frames, destructured. */
  onUpdate?: (asset: string, payload: Record<string, unknown>) => void;
  /** Engine liveness ticks. */
  onHeartbeat?: (ts: string) => void;
  /** Socket errors + JSON-decode failures. */
  onError?: (err: unknown) => void;
  onOpen?: () => void;
  onClose?: (code: number | undefined, reason: string | undefined) => void;
}

/**
 * A live peg-feed subscription over `/v1/ws`.
 *
 * ```ts
 * const feed = new PegFeed({
 *   assets: ["USDC", "JLP"],
 *   onUpdate: (asset, payload) => console.log(asset, payload),
 *   onHeartbeat: (ts) => console.debug("engine alive", ts),
 * });
 * // later: feed.subscribe(["USDe"]); feed.close();
 * ```
 */
export class PegFeed {
  private readonly socket: InstanceType<WebSocketLike>;

  constructor(private readonly opts: PegFeedOptions = {}) {
    const Impl =
      opts.WebSocketImpl ??
      (globalThis as { WebSocket?: WebSocketLike }).WebSocket;
    if (!Impl) {
      throw new Error(
        "No WebSocket implementation found. In browsers / Node ≥ 22 the " +
          "global WebSocket is used; on Node ≤ 21 pass `WebSocketImpl` " +
          "(e.g. `import { WebSocket } from 'ws'`).",
      );
    }
    this.socket = new Impl(opts.wsUrl ?? DEFAULT_WS_URL);
    this.socket.onopen = () => {
      if (opts.assets && opts.assets.length > 0) {
        this.send({ op: "subscribe", assets: opts.assets });
      }
      opts.onOpen?.();
    };
    this.socket.onmessage = (ev) => {
      let msg: PegFeedServerMsg;
      try {
        const raw = typeof ev.data === "string" ? ev.data : String(ev.data);
        msg = JSON.parse(raw) as PegFeedServerMsg;
      } catch (e) {
        opts.onError?.(e);
        return;
      }
      opts.onMessage?.(msg);
      if (msg.op === "update") opts.onUpdate?.(msg.asset, msg.payload);
      else if (msg.op === "heartbeat") opts.onHeartbeat?.(msg.ts);
    };
    this.socket.onerror = (ev) => opts.onError?.(ev);
    this.socket.onclose = (ev) => opts.onClose?.(ev.code, ev.reason);
  }

  /** Send a raw client frame. */
  send(msg: PegFeedClientMsg): void {
    this.socket.send(JSON.stringify(msg));
  }

  /** Add assets to the server-side filter. */
  subscribe(assets: string[]): void {
    this.send({ op: "subscribe", assets });
  }

  /** Remove assets from the server-side filter. */
  unsubscribe(assets: string[]): void {
    this.send({ op: "unsubscribe", assets });
  }

  /** Application-level ping (server replies `{op:"pong"}`). */
  ping(): void {
    this.send({ op: "ping" });
  }

  /** Close the connection. */
  close(): void {
    this.socket.close();
  }
}

/** Convenience: construct and return a connected {@link PegFeed}. */
export function connectPegFeed(opts: PegFeedOptions = {}): PegFeed {
  return new PegFeed(opts);
}
