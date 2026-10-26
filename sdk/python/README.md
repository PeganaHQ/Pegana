# pegana-sdk

Typed Python client for the Pegana peg-risk oracle API.

Asset and state responses may carry `market_observed_at`, the timestamp of the
latest market price tick. Their `state_reason` may include `market_unavailable`,
`market_reference_divergence`, `depth_below_floor`, or `premium_hold_timeout`.

Webhook receivers can call `pegana_sdk.verify_webhook(headers, body, pubkeys_b64)`
with the exact raw body and active keys from `/v1/meta/webhook-keys`. It
requires a valid v2 signature when that header is present, accepts legacy
v1 only when v2 is absent, and enforces a 300-second replay window.

> **v0.4.0**: full OpenAPI-generated coverage of every `/v1` endpoint (typed
> models + a sync/async httpx client via `openapi-python-client`, in the
> `pegana_api_client` package), plus the stable v0.1 receipt-verification
> surface (`pegana_sdk`). Types come from the OpenAPI 3.1 spec — the source of
> truth: <https://api.pegana.xyz/openapi.json>.

> Install with `pip install pegana-sdk`. The latest release on PyPI may lag this
> source; see [CHANGELOG.md](./CHANGELOG.md) for what each version contains.

```sh
# from a checkout of this repo
pip install -e sdk/python/
```

```python
from pegana_api_client import Client
from pegana_api_client.api.assets import list_assets

with Client(base_url="https://api.pegana.xyz") as client:
    envelope = list_assets.sync(client=client)
    for asset in envelope.data:
        # discount = 1 - market/intrinsic: positive = trading below fair value,
        # negative = premium. It is None until the asset has a snapshot.
        print(asset.symbol, asset.state, asset.discount)
```

Live feed over WebSocket:

```python
import asyncio
from pegana_sdk.ws import peg_feed

async def main():
    async for frame in peg_feed():
        if frame["op"] == "update":
            print(frame["asset"], frame["payload"]["state"])

asyncio.run(main())
```

The API is **public and keyless** — no key needed for reads. Full docs:
<https://docs.pegana.xyz>.

## Install from a clone

```sh
pip install ./sdk/python
```

## Full typed client

```python
from pegana_api_client import Client
from pegana_api_client.api.assets import list_assets

# Public read endpoints (tag-organized under pegana_api_client.api.*)
with Client(base_url="https://api.pegana.xyz") as client:
    assets = list_assets.sync(client=client)   # ApiListAssetCard envelope
    if assets:
        for a in assets.data:                  # list envelope → .data
            print(a.symbol)

# Every endpoint is public and read-only; the public API has no /v1/me/*
# or /v1/auth/* surface (receipts live under /v1/audit).
```

`sync_detailed()` / `asyncio_detailed()` variants return the full `Response`
(status + parsed body). LIST endpoints return the ADR-0043 envelope
`{ ok, generated_at, count, data }` — read `.data`; SINGLE resources are bare.
Money fields are exact decimal STRINGS (never floats — parse with `decimal`).
Regenerate with `openapi-python-client generate --url https://api.pegana.xyz/openapi.json --meta none`.

## Receipt verification (v0.1 surface, still supported)

```python
from pegana_sdk import PeganaClient

with PeganaClient() as client:
    # One-shot receipt fetch. The response is NESTED:
    # { alert, evidence, evidence_status }.
    receipt = client.get_audit("4cf3a1d2-7e9b-4b3a-9a7c-9d1e2f3b4c5d")
    print(receipt["alert"]["id"])
    print(receipt["evidence"]["receipt_sha256"])

    # Recent index (last 50, excluding PEGGED)
    recent = client.get_audit_index(limit=50, exclude_pegged=True)

    # On-chain commitment — None unless the alert was anchored (SPL Memo
    # commits are cost-gated to high-severity transitions, so None is common).
    oc = client.get_onchain(receipt["alert"]["id"])
    if oc:
        print(oc["tx_sig"], oc["explorer_url"])

    # Lightweight sha256 verification (NOT cryptographic replay — use the
    # pegana-replay CLI for that).
    v = client.verify_alert(
        receipt["alert"]["id"], receipt["evidence"]["receipt_sha256"]
    )
    print(v.ok)  # True
```

Module-level convenience functions backed by a default client:

```python
from pegana_sdk import get_audit, get_audit_index, get_onchain, verify_alert
```

## Options

```python
PeganaClient(
    base_url="https://api.pegana.xyz",  # default
    client=httpx.Client(timeout=30.0),  # inject for retries / pooling
    timeout=15.0,                       # used if no client passed
)
```

## Live peg feed (WebSocket)

`/v1/ws` is the one endpoint OpenAPI can't model (it's an upgrade stub in the
spec), so the SDK ships a small async helper for it — an async iterator over the
live feed:

```python
import asyncio
from pegana_sdk import peg_feed

async def main():
    async for frame in peg_feed(["USDC", "JLP"]):   # omit the list to receive all
        if frame["op"] == "update":
            print(frame["asset"], frame["payload"])
        elif frame["op"] == "heartbeat":
            print("engine alive", frame["ts"])

asyncio.run(main())
```

The server pushes `{"op":"update", "asset", "payload"}` and `{"op":"heartbeat",
"ts"}`; passing `assets` subscribes to that filter on connect. Backed by the
`websockets` package (a declared dependency) and verifies TLS against `certifi`.

## Roadmap

- **v0.2.0** ✅ — OpenAPI-generated full coverage of every `/v1` endpoint via
  `openapi-python-client` (typed models + sync/async httpx client in
  `pegana_api_client`). The v0.1 `pegana_sdk` receipt surface is retained.
- **v0.3.0** ✅ — version sync (pegana_sdk + pegana_api_client unified under
  one package), classifier cleanup. Published on PyPI as `pegana-sdk 0.3.0`.
  Install with `pip install pegana-sdk`.
- **v0.4.0** ✅ (2026-10-25) — regenerated from the current spec; drops the removed
  `/v1/alerts`, `/v1/auth/*` and `/v1/me/*` modules (breaking). See
  [CHANGELOG.md](./CHANGELOG.md).
- **v1.0.0** — API stability commitment and semver guarantees.
