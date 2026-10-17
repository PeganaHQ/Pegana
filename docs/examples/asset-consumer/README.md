# Pegana asset consumer — reference adapter (grant M1)

Two minimal, copy-pasteable examples showing how an external consumer
(explorer, wallet, aggregator — e.g. tokens.xyz) fetches
`GET https://api.pegana.xyz/v1/assets` and renders each asset's peg
status **correctly** using the `anchor` field.

| Language | File | Runtime |
|---|---|---|
| TypeScript / ESM | `typescript/consumer.mjs` | Node 18+ (zero deps) |
| Python | `python/consumer.py` | Python 3.9+ (stdlib only, `requests` optional) |

---

## Endpoint

```
GET https://api.pegana.xyz/v1/assets
Content-Type: application/json
```

Returns a JSON **array** of asset objects. No authentication is required
for the public feed. Rate limit: 300 requests/minute per IP.

**Caching guidance:** The API has short internal caching. Poll at most
every **30–60 seconds**; more frequent polling wastes quota without
providing fresher data.

---

## Field contract

The fields you need for correct rendering:

| Field | Type | Description |
|---|---|---|
| `mint` | `string` | Solana mint address — the **stable join key**. Always resolve assets by mint, not symbol. |
| `symbol` | `string` | Human-readable ticker, e.g. `"USDC"`. |
| `anchor` | `"USD" \| "FX" \| "NAV"` | How to interpret the discount (see below). |
| `peg_target` | `string` | `"USD"`, `"EUR"`, `"BRL"`, `"SOL"`, … — the reference currency for this anchor. |
| `state` | `PegState` | Engine's **class-aware** verdict. Trust this; do not re-threshold raw discount. |
| `confidence` | `"high" \| "medium" \| "low" \| "unknown"` | Oracle confidence for this reading. |
| `discount` | `string` (decimal fraction) | `"0.012"` = 1.2% **below** fair value (positive = premium, negative = discount). |
| `intrinsic_usd` | `string` | Fair value / NAV in USD. |
| `market_usd` | `string` | Observed market price in USD. |
| `monitoring_only` | `boolean` | `true` = not yet in the calibrated launch set. |
| `calibration` | `"calibrated" \| "provisional"` | `"provisional"` = beta, methodology still validating on mainnet data. |
| `jitter_bps_24h` | `string` | 24 h discount volatility in basis-point fractions. |
| `monitoring_reason` | `string \| null` | Human-readable reason for monitoring-only status. |

> **Format.** All monetary/ratio values (`discount`, `intrinsic_usd`, `market_usd`, `jitter_bps_24h`, …) are exact decimal **strings** — parse with a decimal library, never a float. Trailing zeros are trimmed and USD aggregates (e.g. `market_cap`) are cent-rounded; price/discount fields keep full precision. Timestamps are RFC3339 UTC millisecond-`Z` (`2026-07-24T15:33:14.545Z`). Compare parsed values, not raw strings.

`PegState` values: `PEGGED` · `DRIFT` · `DEPEG` · `CRITICAL` · `BLACK_SWAN` · `UNKNOWN`

---

## Anchor-aware rendering rules

The `anchor` field tells you **how to frame the deviation label** in your UI.

### `anchor === "USD"` — classic stablecoin

The asset is meant to trade 1:1 with the US dollar.

```
discount = "-0.000153"  →  label: "-0.02% from $1"
```

### `anchor === "FX"` — non-USD fiat peg

The asset tracks a non-USD currency. Read `peg_target` for the ticker;
do **not** hard-code `"EUR"`.

```
symbol = "EURC",  peg_target = "EUR",  discount = "-0.000082"
  →  label: "-0.01% from the EUR peg"
```

### `anchor === "NAV"` — liquid staking token or fund share

The fair value (NAV) moves with the underlying collateral (e.g. staked
SOL accrues rewards). **Do not label this a "$1 depeg."** A −1.4%
reading can be the fully normal market discount for a healthy LST.

```
symbol = "JupSOL",  peg_target = "SOL",  discount = "-0.006895"
  →  label: "-0.69% from NAV"
```

---

## Failure modes

### `state === "UNKNOWN"` — fail-safe / degraded

The engine withheld a verdict because oracle inputs were contradictory
or stale. **Do not display a confident number.** Surface the badge and
note that peg status is unavailable.

```json
{ "symbol": "sHYUSD", "state": "UNKNOWN", "confidence": "unknown" }
  →  "Peg status unavailable"
     ⚠ Engine in fail-safe mode — oracle inputs contradictory or stale.
```

### `calibration === "provisional"` — beta

The methodology is still being validated on live mainnet data. Display
a "beta" or "experimental" label alongside the reading. Do not suppress
the reading entirely — it is informative, just not yet production-grade.

### `confidence === "low"` or `"unknown"` — thin oracle data

The price reading may be unreliable (thin DEX liquidity, stale oracle).
Note the uncertainty in the UI; do not hide it.

### `monitoring_only === true` — not in calibrated denominator

The asset is tracked for signal but excluded from the calibrated launch
set (e.g. it exceeded normal drift bands during calibration). Show it
but consider a visual distinction (muted row, info tooltip).

---

## Worked examples

### 1. USDC (USD-anchored stablecoin)

```json
{
  "symbol": "USDC",
  "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "anchor": "USD",
  "peg_target": "USD",
  "state": "PEGGED",
  "confidence": "medium",
  "discount": "0.000153",
  "calibration": "calibrated",
  "monitoring_only": false
}
```

Rendered output:

```
Pegged · +0.02% from $1
```

### 2. EURC (FX-anchored, EUR peg)

```json
{
  "symbol": "EURC",
  "mint": "HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr",
  "anchor": "FX",
  "peg_target": "EUR",
  "state": "PEGGED",
  "confidence": "high",
  "discount": "-0.000082",
  "calibration": "provisional",
  "monitoring_only": true
}
```

Rendered output:

```
Pegged · -0.01% from the EUR peg  [beta] [monitoring-only]
⚠ Beta: provisional calibration — treat as experimental.
```

### 3. JupSOL (NAV-anchored liquid staking token)

```json
{
  "symbol": "JupSOL",
  "mint": "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v",
  "anchor": "NAV",
  "peg_target": "SOL",
  "state": "PEGGED",
  "confidence": "high",
  "discount": "-0.006895",
  "intrinsic_usd": "82.63",
  "market_usd": "83.18",
  "calibration": "calibrated",
  "monitoring_only": false
}
```

Rendered output:

```
Pegged · -0.69% from NAV
```

Note: the −0.69% is the normal market discount (market price slightly
above staking NAV). This is **not** a depeg. The engine already applied
the LST-specific thresholds when it emitted `state: "PEGGED"`.

---

## Running the examples

### TypeScript (Node 18+)

```bash
node typescript/consumer.mjs
```

No install needed. Uses the built-in `fetch` API.

### Python (3.9+)

```bash
python3 python/consumer.py
```

Standard library only. If `requests` is installed it will be used
automatically; otherwise `urllib.request` is the fallback.

---

## Polling pattern (production)

```js
// Refresh every 30 s; back off on error.
let retryMs = 5_000;
async function poll() {
  try {
    const byMint = await fetchAssets();
    updateUI(byMint);
    retryMs = 5_000;
  } catch (err) {
    console.warn("Pegana fetch failed, backing off:", err.message);
    retryMs = Math.min(retryMs * 2, 120_000);
  }
  setTimeout(poll, retryMs);
}
```

---

## See also

- Webhook receivers (real-time alerts): `../webhook-receivers/`
- API reference: `https://api.pegana.xyz/docs`
- Methodology: `https://releases.pegana.xyz` (public `pegana-replay` repo)
