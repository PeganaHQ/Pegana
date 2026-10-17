"""Offline regression tests for the hand-rolled Python SDK.

No network: every request is served by a fake ``httpx.Client`` injected through
the SDK's existing ``client=`` constructor param, returning frozen fixtures
shaped EXACTLY like the live API (crates/api-rs/src/routes/audit.rs).

Run with ``pytest`` (or plain ``python tests/test_sdk.py`` — a stdlib fallback
runner is wired at the bottom so it works even where pytest isn't installed).

Locks two launch-blocker regressions:
  B-012 — verify_alert must read the NESTED receipt["evidence"]["receipt_sha256"],
          not a flat top-level key (else every verify returned ok=False).
  B-028 — get_onchain returns the live { tx_sig, explorer_url, commit_status }
          body with NO phantom ``cluster`` (nor alert_id / memo_format) key,
          and resolves to ``None`` on the 404 that non-committed alerts return.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Optional

# Make the package importable when run directly (pytest handles rootdir itself).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# ── Stub httpx if the real lib isn't installed ──────────────────────────────
# pegana_sdk imports httpx at module load; these tests never touch the network,
# so a minimal stand-in keeps them runnable in a bare environment. When real
# httpx IS present we leave it alone.
if "httpx" not in sys.modules:
    try:  # pragma: no cover - prefer the real dependency when available
        import httpx  # noqa: F401
    except ModuleNotFoundError:  # pragma: no cover - exercised in bare CI
        import types

        _httpx = types.ModuleType("httpx")

        class _Client:  # minimal surface the SDK references
            def __init__(self, *_a: Any, **_k: Any) -> None:
                pass

            def get(self, *_a: Any, **_k: Any) -> Any:  # overridden by FakeClient
                raise RuntimeError("network disabled in tests")

            def close(self) -> None:
                pass

        class _HTTPStatusError(Exception):
            pass

        _httpx.Client = _Client  # type: ignore[attr-defined]
        _httpx.HTTPStatusError = _HTTPStatusError  # type: ignore[attr-defined]
        sys.modules["httpx"] = _httpx

from pegana_sdk import PeganaClient, VerifyResult  # noqa: E402

ALERT_ID = "4cf3a1d2-7e9b-4b3a-9a7c-9d1e2f3b4c5d"
RECEIPT_SHA = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"

# Live nested /v1/audit/{id} body (audit.rs:174-205).
AUDIT_FIXTURE: dict[str, Any] = {
    "alert": {
        "id": ALERT_ID,
        "asset": "USDC",
        "class": "stablecoin",
        "from_state": "PEGGED",
        "to_state": "DRIFT",
        "discount": "0.0021",
        "intrinsic_usd": "1.0000",
        "market_usd": "0.9979",
        "confidence": "high",
        "detected_at": "2026-05-31T12:00:00Z",
    },
    "evidence": {
        "methodology_version": "0.4.2",
        "assets_toml_sha256": "abc123",
        "has_replay_artifact": True,
        "receipt_sha256": RECEIPT_SHA,
        "onchain_tx_sig": None,
        "created_at": "2026-05-31T12:00:01Z",
    },
    "evidence_status": "ready",
}

# Live committed /onchain 200 body (audit.rs:444-449).
ONCHAIN_COMMITTED = {
    "tx_sig": "4XLXT3vSabc",
    "explorer_url": "https://solscan.io/tx/4XLXT3vSabc",
    "commit_status": "committed",
}

# Live 404 body for a non-committed alert (audit.rs:430-438 / 489-497).
ONCHAIN_404 = {
    "error": "not_applicable",
    "commit_status": "not_applicable",
    "detail": "No on-chain anchor for this alert.",
    "alert_id": ALERT_ID,
}


class _FakeResponse:
    def __init__(self, body: Any, status_code: int = 200) -> None:
        self._body = body
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self) -> Any:
        return self._body


class _FakeClient:
    """Route → (body, status) map; no network."""

    def __init__(self, routes: dict[str, tuple[Any, int]]) -> None:
        self._routes = routes

    def get(
        self,
        url: str,
        params: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, Any]] = None,
    ) -> _FakeResponse:
        path = url.split("api.pegana.xyz", 1)[-1]
        if path not in self._routes:
            return _FakeResponse({"error": "not_found"}, 404)
        body, status = self._routes[path]
        return _FakeResponse(body, status)

    def close(self) -> None:
        pass


def _client(routes: dict[str, tuple[Any, int]]) -> PeganaClient:
    return PeganaClient(client=_FakeClient(routes))  # type: ignore[arg-type]


# ── B-012: verify_alert reads the nested evidence sha ───────────────────────


def test_verify_alert_parses_nested_shape() -> None:
    c = _client({f"/v1/audit/{ALERT_ID}": (AUDIT_FIXTURE, 200)})
    v = c.verify_alert(ALERT_ID, RECEIPT_SHA)
    assert isinstance(v, VerifyResult)
    assert v.ok is True
    assert v.actual == RECEIPT_SHA
    assert v.expected == RECEIPT_SHA
    assert v.alert_id == ALERT_ID


def test_verify_alert_mismatch_is_false_not_crash() -> None:
    c = _client({f"/v1/audit/{ALERT_ID}": (AUDIT_FIXTURE, 200)})
    v = c.verify_alert(ALERT_ID, "0" * 64)
    assert v.ok is False
    assert v.actual == RECEIPT_SHA


def test_get_audit_sha_lives_under_evidence() -> None:
    c = _client({f"/v1/audit/{ALERT_ID}": (AUDIT_FIXTURE, 200)})
    r = c.get_audit(ALERT_ID)
    assert r["alert"]["id"] == ALERT_ID
    assert r["evidence"]["receipt_sha256"] == RECEIPT_SHA
    # B-012: there is NO flat top-level receipt_sha256.
    assert "receipt_sha256" not in r


# ── B-028: onchain shape + 404 → None ───────────────────────────────────────


def test_get_onchain_committed_shape_has_no_phantom_cluster() -> None:
    c = _client({f"/v1/audit/{ALERT_ID}/onchain": (ONCHAIN_COMMITTED, 200)})
    oc = c.get_onchain(ALERT_ID)
    assert oc is not None
    assert oc["tx_sig"] == ONCHAIN_COMMITTED["tx_sig"]
    assert oc["explorer_url"] == ONCHAIN_COMMITTED["explorer_url"]
    assert oc["commit_status"] == "committed"
    # B-028: the live response has no `cluster` (nor alert_id / memo_format).
    assert "cluster" not in oc
    assert "alert_id" not in oc
    assert "memo_format" not in oc
    assert set(oc.keys()) == {"tx_sig", "explorer_url", "commit_status"}


def test_get_onchain_404_returns_none() -> None:
    c = _client({f"/v1/audit/{ALERT_ID}/onchain": (ONCHAIN_404, 404)})
    assert c.get_onchain(ALERT_ID) is None


def test_get_onchain_non_404_error_raises() -> None:
    c = _client({f"/v1/audit/{ALERT_ID}/onchain": ({"error": "boom"}, 500)})
    raised = False
    try:
        c.get_onchain(ALERT_ID)
    except Exception:
        raised = True
    assert raised, "non-404 errors must propagate"


# ── stdlib fallback runner (so it works without pytest installed) ───────────

if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except Exception as exc:  # noqa: BLE001
                failures += 1
                print(f"FAIL {name}: {exc!r}")
    if failures:
        sys.exit(f"{failures} test(s) failed")
    print("all SDK regression tests passed")
