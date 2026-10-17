"""
Pegana webhook receiver — Python / FastAPI reference.

Verifies an Ed25519-signed Pegana webhook using `cryptography`.
Same security envelope as the TypeScript / Cloudflare Worker and
Rust / axum samples in sibling folders.

Headers you can rely on (Sprint 1a+):
    x-pegana-signature      ed25519:<base64 sig>
    x-pegana-timestamp      unix seconds (signed input is `<ts>.<body>`)
    x-pegana-event-id       stable across retries — dedup on this
    x-pegana-delivery-id    fresh per attempt — log correlation
    x-pegana-attempt        "<n>/<max>" — page on n == max-1

Idempotency demo: a process-local in-memory set of `event_id` is used
below — swap for Redis / Postgres / Cloudflare KV in production.
"""

import base64
import json
import time
from collections import OrderedDict

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import FastAPI, HTTPException, Request

# Active Pegana Ed25519 public keys.
#
# Authoritative source: GET https://api.pegana.xyz/v1/meta/webhook-keys
#   { "pubkeys_b64": [primary, secondary?] }
#
# During a key rotation window BOTH keys are live — pre-trust the new
# pubkey before the cutover by polling /v1/meta/webhook-keys at least
# daily. Set PEGANA_PUB_KEY_B64 as a CSV ("primary,secondary") to load
# both at boot. The dual-key trust loop below tries each in order.
import os

DEFAULT_PEGANA_PUB_KEYS_B64 = "gAKAhNG4BLCF0xm/gCcDb0OcP6cxzt1IfXkmkzyVYVo="
REPLAY_WINDOW_SEC = 300
DEDUP_MAX_ENTRIES = 10_000  # bounded LRU; swap for Redis/PG in prod.

app = FastAPI()


def _load_pubkeys() -> list[Ed25519PublicKey]:
    raw = os.environ.get("PEGANA_PUB_KEY_B64", DEFAULT_PEGANA_PUB_KEYS_B64)
    return [
        Ed25519PublicKey.from_public_bytes(base64.b64decode(b64.strip()))
        for b64 in raw.split(",")
        if b64.strip()
    ]


_pubs = _load_pubkeys()

# Bounded in-memory dedup set keyed by x-pegana-event-id. Production should
# back this with Redis (`SET event:<id> 1 EX 86400 NX`) or Postgres so the
# guarantee survives restart + horizontal scale.
_seen: "OrderedDict[str, None]" = OrderedDict()


def _seen_before(event_id: str) -> bool:
    if event_id in _seen:
        # Move-to-end keeps the LRU ordering meaningful.
        _seen.move_to_end(event_id)
        return True
    _seen[event_id] = None
    if len(_seen) > DEDUP_MAX_ENTRIES:
        _seen.popitem(last=False)
    return False


@app.post("/")
async def webhook(req: Request) -> dict[str, str]:
    sig = req.headers.get("x-pegana-signature")
    ts = req.headers.get("x-pegana-timestamp")
    if not sig or not ts:
        raise HTTPException(401, "missing signature headers")
    try:
        ts_i = int(ts)
    except ValueError as exc:
        raise HTTPException(401, "bad timestamp") from exc
    if abs(int(time.time()) - ts_i) > REPLAY_WINDOW_SEC:
        raise HTTPException(401, "stale")

    body = (await req.body()).decode("utf-8")
    sig_b64 = sig.replace("ed25519:", "", 1)

    try:
        sig_bytes = base64.b64decode(sig_b64)
        if len(sig_bytes) != 64:
            raise HTTPException(401, "bad signature length")
    except ValueError as exc:
        raise HTTPException(401, "bad signature encoding") from exc

    # Dual-key trust: try every active pubkey in order. Either valid
    # signature passes — supports zero-downtime rotation.
    signed = f"{ts}.{body}".encode("utf-8")
    for pub in _pubs:
        try:
            pub.verify(sig_bytes, signed)
            break
        except InvalidSignature:
            continue
    else:
        raise HTTPException(401, "bad signature")

    # Cross-attempt dedup via x-pegana-event-id (stable across retries).
    # Returning 200 on a duplicate tells Pegana to stop retrying.
    event_id = req.headers.get("x-pegana-event-id")
    attempt = req.headers.get("x-pegana-attempt", "?")
    if event_id and _seen_before(event_id):
        print(f"dedup hit event={event_id} attempt={attempt}")
        return {"status": "duplicate ignored"}

    event = json.loads(body)
    # Your business logic here. Examples:
    #   redis.set(f"pegana:seen:{event['alert_id']}", "1", ex=86400)
    #   await slack_post(f"{event['asset']} → {event['to_state']}")
    print(f"verified event={event_id} attempt={attempt}:", event)

    return {"status": "ok"}
