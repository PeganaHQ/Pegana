#!/usr/bin/env python3
"""
tokens-xyz-peg-join.py — build the Pegana `include=peg` payload over tokens.xyz's
real catalog, by RESOLVING each Pegana mint against tokens.xyz.

The integration thesis (docs/strategy/2026-06-17-pegana-x-tokens-xyz.md): tokens.xyz
lists every representation of an asset but shows no peg/NAV signal. Pegana computes
exactly that. tokens.xyz collapses variants onto a canonical `assetId` (jitoSOL →
`solana`; USDT → `usd`), each variant keyed by `mint`. So the clean join = resolve
each Pegana mint → if tokens.xyz lists it, attach Pegana's live peg reading, grouped
by their canonical `assetId` (which is exactly how they'd serve `GET /assets/:id
?include=peg`).

USAGE
  export TOKENS_API_KEY=<key from https://app.tokens.xyz>
  python3 scripts/tokens-xyz-peg-join.py          # coverage report + grouped sample
  python3 scripts/tokens-xyz-peg-join.py --json    # full include=peg, grouped by assetId

Only the tokens.xyz key is a secret; api.pegana.xyz is a public good feed.
"""
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

TOKENS_BASE = os.environ.get("TOKENS_BASE", "https://api.tokens.xyz/v1")
PEGANA_BASE = os.environ.get("PEGANA_BASE", "https://api.pegana.xyz/v1")
TOKENS_KEY = os.environ.get("TOKENS_API_KEY", "")

# Pegana covers these classes today; everything else stays unmapped (honest gap).
SUPPORTED_CLASSES = {
    "stable_fiat", "stable_fx", "stable_cdp", "stable_dn", "stable_yield",
    "lst", "stable_rwa",
}


def _get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode())


def fetch_pegana_by_mint():
    out = {}
    # /v1/assets returns the list envelope {ok, generated_at, count, data};
    # read the rows from `data` (tolerate a bare array for older servers).
    body = _get(f"{PEGANA_BASE}/assets")
    rows = body if isinstance(body, list) else body.get("data", [])
    for a in rows:
        if a.get("mint"):
            out[a["mint"]] = a
    return out


def resolve_mint(mint):
    """tokens.xyz /assets/resolve?mint= → {assetId, asset, variant} or None if unlisted."""
    try:
        r = _get(f"{TOKENS_BASE}/assets/resolve?mint={mint}",
                 {"x-api-key": TOKENS_KEY, "Content-Type": "application/json"})
        return r if r.get("asset") else None
    except urllib.error.HTTPError as e:
        if e.code in (400, 404):
            return None
        raise


def peg_block(a, variant=None):
    disc = a.get("discount")
    try:
        bps = round(float(disc) * 10000) if disc is not None else None
    except (TypeError, ValueError):
        bps = None
    blk = {
        "symbol": a.get("symbol"),
        "state": a.get("state"),
        "discount": disc,
        "discount_bps": bps,
        "calibration": a.get("calibration"),
        "confidence": a.get("confidence"),
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "receipt_url": f"https://pegana.xyz/audit?asset={a.get('symbol')}",
    }
    if variant:  # echo tokens.xyz's own variant label/tier for cross-checking
        blk["tokens_variant"] = {
            "label": variant.get("label"), "kind": variant.get("kind"),
            "liquidityTier": variant.get("liquidityTier"),
            "trustTier": variant.get("trustTier"), "tags": variant.get("tags"),
        }
    return blk


def main():
    if not TOKENS_KEY:
        sys.exit("ERROR: set TOKENS_API_KEY (self-serve at https://app.tokens.xyz)")
    flags = {a for a in sys.argv[1:] if a.startswith("--")}

    print(f"→ Pegana feed ({PEGANA_BASE}) …", file=sys.stderr)
    pegana = fetch_pegana_by_mint()
    print(f"  · {len(pegana)} Pegana assets — resolving each mint on tokens.xyz …",
          file=sys.stderr)

    by_asset = {}      # tokens.xyz assetId -> { mint: peg_block }
    covered, unlisted = [], []
    for mint, a in pegana.items():
        r = resolve_mint(mint)
        if r:
            aid = r.get("assetId", "?")
            by_asset.setdefault(aid, {})[mint] = peg_block(a, r.get("variant"))
            covered.append(f"{a['symbol']}→{aid}")
        else:
            unlisted.append(a["symbol"])

    if "--json" in flags:
        print(json.dumps(
            {aid: {"peg": {"ok": True, "data": d}} for aid, d in by_asset.items()},
            indent=2))
        return

    print("\n=== COVERAGE (resolved Pegana mints against the tokens.xyz catalog) ===")
    print(f"Pegana assets                 : {len(pegana)}")
    print(f"  ✅ listed on tokens.xyz      : {len(covered)}")
    print(f"  ◻️  not on tokens.xyz yet     : {len(unlisted)}  {sorted(unlisted)}")
    print(f"tokens.xyz canonical assets hit: {sorted(by_asset)}")
    print("\nPer-asset overlap:")
    for aid, d in sorted(by_asset.items()):
        syms = [b["symbol"] for b in d.values()]
        print(f"  {aid:12} ← {syms}")
    print("\n=== include=peg sample (one canonical asset) ===")
    if by_asset:
        aid = max(by_asset, key=lambda k: len(by_asset[k]))
        print(json.dumps({aid: {"peg": {"ok": True, "data": by_asset[aid]}}}, indent=2))
    print("\n(run with --json for every canonical asset)")


if __name__ == "__main__":
    main()
