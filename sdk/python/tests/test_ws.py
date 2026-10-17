"""Tests for the live peg-feed WebSocket helper (``pegana_sdk.ws``).

Structural checks always run; a live call to wss://api.pegana.xyz/v1/ws runs only
when ``PEGANA_SDK_LIVE=1`` so offline/CI stays hermetic.
"""

from __future__ import annotations

import asyncio
import inspect
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_peg_feed_is_exported_async_generator() -> None:
    from pegana_sdk import DEFAULT_WS_URL, peg_feed

    assert DEFAULT_WS_URL == "wss://api.pegana.xyz/v1/ws"
    assert inspect.isasyncgenfunction(peg_feed)


def test_live_peg_feed() -> None:
    """PEGANA_SDK_LIVE=1: connect to the real feed and decode the first frame."""
    if os.environ.get("PEGANA_SDK_LIVE") != "1":
        return  # gated — skip offline/CI
    from pegana_sdk import peg_feed

    async def _first() -> dict:
        async for frame in peg_feed():
            return frame
        raise AssertionError("stream ended with no frame")

    frame = asyncio.run(asyncio.wait_for(_first(), timeout=15))
    assert frame["op"] in ("update", "heartbeat", "pong", "error")


if __name__ == "__main__":
    test_peg_feed_is_exported_async_generator()
    test_live_peg_feed()
    print("ok")
