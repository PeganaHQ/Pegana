# @peganahq/sdk-ts

Typed TypeScript client for the Pegana peg-risk oracle API.

> **v0.3.1** — full OpenAPI-generated coverage of every `/v1` endpoint (typed
> `data`/`error` per operation via [`openapi-fetch`]), plus the stable v0.1
> receipt-verification surface. Types are generated from the OpenAPI 3.1 spec —
> the source of truth: <https://api.pegana.xyz/openapi.json> (regenerate with
> `bun run gen`).

```sh
npm install @peganahq/sdk-ts
```

```ts
import { createPeganaApi, unwrapList } from "@peganahq/sdk-ts";

const api = createPeganaApi();

// Every list endpoint returns { ok, generated_at, count, data } — unwrapList
// hands you the rows.
const { data } = await api.GET("/v1/assets");
for (const asset of unwrapList(data)) {
  console.log(asset.symbol, asset.state, asset.discount);
}
```

Live feed over WebSocket:

```ts
import { connectPegFeed } from "@peganahq/sdk-ts";

for await (const frame of connectPegFeed()) {
  if (frame.op === "update") console.log(frame.asset, frame.payload.state);
}
```

The API is **public and keyless** — no key needed for reads. Full docs:
<https://docs.pegana.xyz>.

[`openapi-fetch`]: https://openapi-ts.dev/openapi-fetch

## Install from a clone

```sh
npm install file:./sdk/typescript
```

## Full typed client (v0.2.0)

```ts
import { createPeganaApi, unwrapList } from "@peganahq/sdk-ts";

const api = createPeganaApi(); // baseUrl defaults to https://api.pegana.xyz

// LIST endpoints return the ADR-0043 envelope { ok, generated_at, count, data }.
const { data, error } = await api.GET("/v1/assets");
if (data) for (const a of unwrapList(data)) console.log(a.symbol);

// SINGLE resources are bare (no envelope). Path params are typed.
const one = await api.GET("/v1/assets/{symbol}", {
  params: { path: { symbol: "USDC" } },
});

// Loop-Intelligence cascade, peg feed, methodology, stats, calibration, audit …
const feed = await api.GET("/v1/peg/feed");

// Authenticated surface (/v1/me/*) — pass a telegram_jwt (POST /v1/auth/telegram):
const me = createPeganaApi({ token });
const subs = await me.GET("/v1/me/subs");
```

Money fields are exact decimal **strings** (never floats — trailing zeros
trimmed, USD rounded to cents). Parse with a decimal library for arithmetic;
`toNumberUnsafe(s)` is a display-only helper. The generated `paths`,
`components`, and `operations` types are re-exported for naming request/response
shapes.

## Receipt verification (v0.1 surface, still supported)

```ts
import { PeganaClient } from "@peganahq/sdk-ts";

const client = new PeganaClient();

// One-shot receipt fetch. The response is NESTED:
// { alert, evidence, evidence_status }.
const receipt = await client.getAudit("4cf3a1d2-7e9b-4b3a-9a7c-9d1e2f3b4c5d");
console.log(receipt.alert.id);
console.log(receipt.evidence.receipt_sha256);

// Recent index (last 50, excluding PEGGED)
const recent = await client.getAuditIndex({ limit: 50, excludePegged: true });

// On-chain commitment — null unless the alert was anchored (SPL Memo commits
// are cost-gated to high-severity transitions, so null is the common case).
const oc = await client.getOnchain(receipt.alert.id);
if (oc) console.log(oc.tx_sig, oc.explorer_url);

// Lightweight sha256 verification (NOT cryptographic replay — use the
// pegana-replay CLI for that).
const v = await client.verifyAlert(
  receipt.alert.id,
  receipt.evidence.receipt_sha256,
);
console.log(v.ok); // true
```

Convenience module-level helpers backed by a default client:

```ts
import { getAudit, getAuditIndex, getOnchain, verifyAlert } from "@peganahq/sdk-ts";
```

## Options

```ts
new PeganaClient({
  baseUrl: "https://api.pegana.xyz", // default
  fetch:    globalThis.fetch,         // override for node-fetch / undici
  timeoutMs: 15_000,                  // per-request abort
});
```

## Roadmap

- **v0.2.0** ✅ — OpenAPI-generated full coverage of every `/v1` endpoint via
  `openapi-typescript` + `openapi-fetch`, with the ADR-0043 list-envelope helper
  and a bearer-auth option for `/v1/me/*`. The v0.1 receipt surface is retained.
- **v0.3.1** ✅ — published to npm under `@peganahq/sdk-ts`.
- **v1.0.0** — API stability commitment, semver guarantees.

## Live peg feed (WebSocket)

`/v1/ws` is the one endpoint OpenAPI can't model (it's an upgrade stub in the
spec), so the SDK ships a thin typed helper for it:

```ts
import { PegFeed } from "@peganahq/sdk-ts";

const feed = new PegFeed({
  assets: ["USDC", "JLP"],                       // omit to receive all
  onUpdate: (asset, payload) => console.log(asset, payload),
  onHeartbeat: (ts) => console.debug("engine alive", ts),
});
// later: feed.subscribe(["USDe"]); feed.unsubscribe(["JLP"]); feed.close();
```

The server pushes `{op:"update", asset, payload}` and `{op:"heartbeat", ts}`;
the client may `subscribe`/`unsubscribe`/`ping`. Uses `globalThis.WebSocket`
(browsers, Node ≥ 22, Bun); on Node ≤ 21 pass `WebSocketImpl` (e.g. the `ws`
package). Server-to-server clients need no `Origin` header.
