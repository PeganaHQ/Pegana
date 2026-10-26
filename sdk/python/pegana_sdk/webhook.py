"""Verify Pegana webhook signatures against the active Ed25519 public keys."""

from __future__ import annotations

import base64
import binascii
import json
import re
import time
from collections.abc import Mapping, Sequence

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

_EVENT_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def verify_webhook(
    headers: Mapping[str, str],
    body: bytes | str,
    pubkeys_b64: Sequence[str],
    *,
    now_sec: int | None = None,
) -> bool:
    """Verify v2 when present, otherwise legacy v1, within a 300-second window.

    Pass the exact raw request body and active keys from the webhook-keys API.
    The event id is opaque; it can differ from alert_id in the body.
    """
    h = {key.lower(): value for key, value in headers.items()}
    timestamp = h.get("x-pegana-timestamp", "")
    event_id = h.get("x-pegana-event-id", "")
    v2 = h.get("x-pegana-signature-v2")
    signature = v2 if v2 is not None else h.get("x-pegana-signature")
    if not timestamp.isascii() or not timestamp.isdecimal() or not _EVENT_ID.fullmatch(event_id) or not signature:
        return False
    if not signature.startswith("ed25519:"):
        return False
    ts = int(timestamp)
    if abs((now_sec if now_sec is not None else int(time.time())) - ts) > 300:
        return False
    try:
        raw = body.encode("utf-8") if isinstance(body, str) else body
        json.loads(raw.decode("utf-8"))
        sig = base64.b64decode(signature[len("ed25519:"):], validate=True)
    except (UnicodeError, ValueError, binascii.Error):
        return False
    if len(sig) != 64:
        return False
    prefix = (
        f"pegana-webhook-v2.{timestamp}.{event_id}."
        if v2 is not None
        else f"{timestamp}."
    ).encode("utf-8")
    message = prefix + raw
    for pubkey_b64 in pubkeys_b64:
        try:
            key = base64.b64decode(pubkey_b64, validate=True)
            if len(key) != 32:
                continue
            Ed25519PublicKey.from_public_bytes(key).verify(sig, message)
            return True
        except (InvalidSignature, ValueError, binascii.Error):
            continue
    return False
