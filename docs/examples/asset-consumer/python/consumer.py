"""
Pegana asset consumer — Python reference implementation.

Demonstrates how an explorer or wallet (e.g. tokens.xyz) fetches
GET https://api.pegana.xyz/v1/assets and renders each asset's peg
status correctly using the ``anchor`` field.

Dependency-light: only the standard library is required. If ``requests``
is available it will be used, otherwise the code falls back to
``urllib.request`` so this file is paste-and-go in any Python 3.9+
environment.

Usage::

    python3 consumer.py

Key contract
------------
* Resolve assets by ``mint`` (stable join key across updates).
* TRUST the engine's ``state`` — never re-threshold ``discount`` yourself.
  An LST trading at −1.4% is PEGGED; its drift band is wider than a
  stablecoin's.
* Use ``anchor`` to decide how to phrase the deviation:

    ``"USD"`` → "X% from $1"                   (classic stablecoin)
    ``"FX"``  → "X% from the <target> peg"     (EURC, BRL-backed, etc.)
    ``"NAV"`` → "X% from NAV"                  (LST / fund share — NAV moves)

* Always surface ``confidence``; a ``"low"`` or ``"unknown"`` reading means
  oracle data is thin — don't render a confident number.
* Flag ``calibration == "provisional"`` (beta, experimental); the
  methodology is still being validated on mainnet data.
* Flag ``state == "UNKNOWN"`` (fail-safe / degraded) — the engine
  withheld a verdict because inputs were contradictory or stale.
* ``discount`` is a fraction (e.g. 0.012 = 1.2% below fair value).
  Positive → premium above fair value; negative → discount below.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from typing import Optional

ASSETS_URL = "https://api.pegana.xyz/v1/assets"


# ─── Fetch ────────────────────────────────────────────────────────────────────

def _fetch_json(url: str, timeout: int = 10) -> object:
    """Fetch JSON from *url*. Uses ``requests`` if available, else urllib."""
    try:
        import requests  # optional, nicer error messages
        resp = requests.get(url, headers={"Accept": "application/json"}, timeout=timeout)
        resp.raise_for_status()
        return resp.json()
    except ImportError:
        from urllib.request import Request, urlopen
        req = Request(url, headers={"Accept": "application/json"})
        with urlopen(req, timeout=timeout) as resp:  # noqa: S310
            return json.loads(resp.read().decode())


def fetch_assets() -> dict[str, dict]:
    """
    Fetches the current asset list and returns a mint-keyed dict.

    Poll at most every 30–60 s; the API has short internal caching.

    Returns
    -------
    dict[str, dict]
        Mapping of Solana mint address → raw asset payload.
    """
    # List endpoints return the envelope ``{ok, generated_at, count, data}`` —
    # read the rows from ``data`` (tolerate a bare array for older servers).
    body = _fetch_json(ASSETS_URL)
    assets: list[dict] = body if isinstance(body, list) else body["data"]  # type: ignore[assignment,index]
    # Index by mint for O(1) lookup — the typical consumer key.
    return {a["mint"]: a for a in assets}


# ─── Anchor-aware rendering ───────────────────────────────────────────────────

STATE_BADGE: dict[str, dict[str, str]] = {
    "PEGGED":     {"label": "Pegged",     "color": "green"},
    "DRIFT":      {"label": "Drift",      "color": "yellow"},
    "DEPEG":      {"label": "Depeg",      "color": "orange"},
    "CRITICAL":   {"label": "Critical",   "color": "red"},
    "BLACK_SWAN": {"label": "Black Swan", "color": "red"},
    "UNKNOWN":    {"label": "Unknown",    "color": "gray"},
}


def _format_pct(discount: str | float, decimals: int = 2) -> str:
    """
    Formats a discount fraction as a signed percentage string.

    Examples::

        _format_pct("-0.014869")  →  "-1.49%"
        _format_pct("0.000153")   →  "+0.02%"
    """
    n = float(discount)
    pct = n * 100
    sign = "+" if pct >= 0 else ""
    return f"{sign}{pct:.{decimals}f}%"


@dataclass
class RenderedPeg:
    label: str
    state: str
    color: str
    notes: list[str] = field(default_factory=list)


def render_peg(asset: dict) -> RenderedPeg:
    """
    Renders a human-readable peg description for one asset.

    This is the core M1 adapter function: an external consumer (explorer,
    wallet, aggregator) can call this without knowing Pegana's internal
    taxonomy.  The ``anchor`` field drives the correct framing.

    Rules
    -----
    state == "UNKNOWN"
        Fail-safe; engine withheld a verdict. Surface the badge but do
        NOT display a confident number.
    calibration == "provisional"
        Beta; flag as experimental.
    anchor == "USD"
        "X% from $1"
    anchor == "FX"
        "X% from the <peg_target> peg" — read ``peg_target`` for the
        currency (EUR, BRL, …); do not hard-code "EUR".
    anchor == "NAV"
        "X% from NAV" — NAV itself moves (e.g. staked SOL accrues
        rewards). Do NOT call this a "$1 depeg".
    confidence == "low" | "unknown"
        Note the uncertainty.

    Parameters
    ----------
    asset:
        A single asset dict from the /v1/assets array.

    Returns
    -------
    RenderedPeg
    """
    state = asset.get("state", "UNKNOWN")
    badge = STATE_BADGE.get(state, {"label": state, "color": "gray"})
    notes: list[str] = []

    # Fail-safe / degraded: engine withheld verdict — no confident number.
    if state == "UNKNOWN":
        return RenderedPeg(
            label="Peg status unavailable",
            state=state,
            color=badge["color"],
            notes=[
                "Engine in fail-safe mode — oracle inputs contradictory or stale.",
                *(["Beta: methodology provisional."] if asset.get("calibration") == "provisional" else []),
            ],
        )

    # Beta flag: methodology is still being validated.
    if asset.get("calibration") == "provisional":
        notes.append("Beta: provisional calibration — treat as experimental.")

    # Low/unknown oracle confidence: flag the uncertainty.
    confidence = asset.get("confidence", "unknown")
    if confidence in ("low", "unknown"):
        notes.append(f"Oracle confidence: {confidence} — reading may be unreliable.")

    # Build the deviation label, anchor-aware.
    pct = _format_pct(asset.get("discount", "0"))
    anchor = asset.get("anchor", "USD")
    peg_target = asset.get("peg_target", "USD")

    if anchor == "USD":
        # Classic stablecoin pegged 1:1 to the US dollar.
        deviation_label = f"{pct} from $1"

    elif anchor == "FX":
        # Fiat-backed token tracking a non-USD currency (e.g. EURC → EUR).
        # peg_target tells you which currency — use it, don't hard-code "EUR".
        deviation_label = f"{pct} from the {peg_target} peg"

    elif anchor == "NAV":
        # Liquid staking token or fund share. Fair value (NAV) moves with
        # the underlying (e.g. staked SOL accrues rewards). A −1.4% reading
        # is normal for a healthy LST. Do NOT say "from $1" here.
        deviation_label = f"{pct} from NAV"

    else:
        # Forward-compatible: unknown future anchor type.
        deviation_label = f"{pct} deviation"

    return RenderedPeg(
        label=f"{badge['label']} · {deviation_label}",
        state=state,
        color=badge["color"],
        notes=notes,
    )


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    print(f"Fetching {ASSETS_URL} …\n")
    by_mint = fetch_assets()

    print(f"Loaded {len(by_mint)} assets.\n")
    print("─" * 72)

    for asset in by_mint.values():
        rendered = render_peg(asset)
        prov_flag = " [beta]" if asset.get("calibration") == "provisional" else ""
        mo_flag   = " [monitoring-only]" if asset.get("monitoring_only") else ""

        symbol = asset.get("symbol", "?")
        mint   = asset.get("mint", "")
        anchor = asset.get("anchor", "?")
        state  = asset.get("state", "?")
        conf   = asset.get("confidence", "?")

        print(f"{symbol:<12} {mint[:8]}…")
        print(f"  anchor:{anchor:<5} state:{state:<11} conf:{conf}")
        print(f"  → {rendered.label}{prov_flag}{mo_flag}")
        for note in rendered.notes:
            print(f"     ⚠ {note}")
        print()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"Fatal: {exc}", file=sys.stderr)
        sys.exit(1)
