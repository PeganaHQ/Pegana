import type { ServerMsg } from "./types";

interface CreateOpts {
  onUpdate: (asset: string, payload: Record<string, unknown>) => void;
  /** Engine emits one of these every ~5s — surface it to drive an "engine alive" indicator. */
  onHeartbeat?: (ts: string) => void;
  onError?: (msg: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
  /** Fired when the socket goes silent (no frame within `heartbeatTimeoutMs`).
   *  A WebSocket can stay 'open' while the server stops sending — `onclose`
   *  never fires — leaving the UI showing frozen "live" numbers. Use this to
   *  mark the feed stale; the client also force-closes so reconnect runs. */
  onStale?: () => void;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  /** Silence window before the feed is considered stale. The engine ticks
   *  ~5s, so the default (~3 missed beats) avoids false positives. */
  heartbeatTimeoutMs?: number;
}

export function createWsClient(url: string, opts: CreateOpts) {
  let socket: WebSocket | null = null;
  let stopped = false;
  let backoff = opts.initialBackoffMs ?? 800;
  const maxBackoff = opts.maxBackoffMs ?? 30_000;
  const heartbeatTimeout = opts.heartbeatTimeoutMs ?? 15_000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let staleTimer: ReturnType<typeof setTimeout> | null = null;

  function clearWatchdog() {
    if (staleTimer) {
      clearTimeout(staleTimer);
      staleTimer = null;
    }
  }

  // (Re)arm the silence watchdog. Called on open and on every inbound frame, so
  // it only fires when the engine has actually gone quiet — at which point we
  // signal staleness and force-close so the onclose → reconnect path runs.
  function armWatchdog() {
    clearWatchdog();
    staleTimer = setTimeout(() => {
      opts.onStale?.();
      // Closing fires onclose, which runs the single reconnect path.
      socket?.close();
    }, heartbeatTimeout);
  }

  // Drop a socket without leaving handlers that could schedule a reconnect or
  // fire callbacks for a connection that is no longer the current one.
  function retire(s: WebSocket | null) {
    if (!s) return;
    s.onopen = null;
    s.onmessage = null;
    s.onclose = null;
    s.onerror = null;
    s.close();
  }

  function open() {
    if (stopped) return;
    // Never hold two sockets: the server caps WS per IP and fans every update
    // to every socket, so an orphan wastes a slot and a Redis subscription.
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    clearWatchdog();
    retire(socket);
    const current = new WebSocket(url);
    socket = current;
    socket.onopen = () => {
      backoff = opts.initialBackoffMs ?? 800;
      armWatchdog();
      opts.onOpen?.();
    };
    socket.onmessage = (ev) => {
      armWatchdog();
      try {
        const msg = JSON.parse(ev.data as string) as ServerMsg;
        if (msg.op === "update") opts.onUpdate(msg.asset, msg.payload);
        else if (msg.op === "heartbeat") opts.onHeartbeat?.(msg.ts);
        else if (msg.op === "error") opts.onError?.(msg.msg);
      } catch {
        // ignore malformed frame
      }
    };
    socket.onclose = () => {
      clearWatchdog();
      opts.onClose?.();
      if (stopped) return;
      reconnectTimer = setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, maxBackoff);
    };
    socket.onerror = () => {
      // close handler will fire next
    };
  }

  return {
    connect() {
      stopped = false;
      // Idempotent: a second connect() must not open a second socket.
      if (socket && socket.readyState <= 1) return;
      open();
    },
    disconnect() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      clearWatchdog();
      retire(socket);
      socket = null;
    },
    send(msg: object) {
      socket?.send(JSON.stringify(msg));
    },
  };
}
