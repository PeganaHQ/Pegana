"""Live peg-feed WebSocket helper — the one endpoint OpenAPI can't model.

`/v1/ws` is only an upgrade stub in the spec, so it isn't part of the generated
``pegana_api_client``. This mirrors the server protocol in
``crates/api-rs/src/ws.rs``: the server pushes ``{"op":"update","asset",
"payload"}`` discount updates (from Redis pub/sub) and ``{"op":"heartbeat","ts"}``
liveness frames; the client may send ``{"op":"subscribe"|"unsubscribe",
"assets":[...]}`` to filter and ``{"op":"ping"}`` (→ ``{"op":"pong"}``).
Server-to-server clients need no ``Origin`` header (api-rs allows a missing
Origin; only a present-but-unallowlisted one is rejected).

Requires the ``websockets`` package (a declared dependency).
"""

from __future__ import annotations

import json
import ssl
from typing import AsyncIterator, Optional, Sequence

import certifi
import websockets

DEFAULT_WS_URL = "wss://api.pegana.xyz/v1/ws"


async def peg_feed(
    assets: Optional[Sequence[str]] = None,
    *,
    ws_url: str = DEFAULT_WS_URL,
) -> AsyncIterator[dict]:
    """Async-iterate live peg-feed frames from ``/v1/ws``.

    Yields decoded server frames — ``{"op":"update",...}``,
    ``{"op":"heartbeat",...}``, ``{"op":"pong"}``, ``{"op":"error",...}``. When
    ``assets`` is given, subscribes to that filter on connect; otherwise receives
    updates for all tracked assets.

    Example::

        from pegana_sdk import peg_feed

        async for frame in peg_feed(["USDC", "JLP"]):
            if frame["op"] == "update":
                print(frame["asset"], frame["payload"])
    """
    # Verify TLS against certifi's CA bundle (matches httpx; sidesteps the macOS
    # system-Python "certificate verify failed" trap). Plain ws:// (local dev)
    # needs no SSL context.
    ssl_ctx = (
        ssl.create_default_context(cafile=certifi.where())
        if ws_url.startswith("wss")
        else None
    )
    async with websockets.connect(ws_url, ssl=ssl_ctx) as ws:
        if assets:
            await ws.send(json.dumps({"op": "subscribe", "assets": list(assets)}))
        async for raw in ws:
            yield json.loads(raw)
