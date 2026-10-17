"""Pegana Python SDK — receipt-verification + full /v1 API client.

v0.3.0 ships the stable v0.1 receipt-verification surface (verify_alert,
get_onchain, peg_feed) plus the OpenAPI-generated `pegana_api_client`
package covering every /v1 endpoint with typed models + sync/async httpx.
The spec lives at https://api.pegana.xyz/openapi.json.

Not yet on PyPI — install from source until published.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

import httpx

from .ws import DEFAULT_WS_URL, peg_feed

DEFAULT_BASE_URL = "https://api.pegana.xyz"
DEFAULT_TIMEOUT = 15.0


@dataclass
class VerifyResult:
    #: Definitive verdict: ``True`` only when the receipt is ``ready`` AND its
    #: sha matches ``expected``. ``False`` means EITHER ready-but-mismatched
    #: (tampered) OR not-yet-ready — branch on ``status`` to tell them apart.
    ok: bool
    #: Receipt materialization status: ``ready`` | ``pending`` | ``failed_permanent``
    #: (or ``unknown``). ``ok`` is only meaningful when ``ready``.
    status: str
    expected: str
    actual: str
    alert_id: str


class PeganaClient:
    """Thin wrapper around the four public-receipt endpoints.

    Usage::

        from pegana_sdk import PeganaClient

        client = PeganaClient()
        receipt = client.get_audit("4cf3a1d2-7e9b-4b3a-9a7c-9d1e2f3b4c5d")
        # Response is nested: { alert, evidence, evidence_status }.
        print(receipt["evidence"]["receipt_sha256"])

    For production, pass an httpx.Client so connection pooling and retries
    are managed by the caller.
    """

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        client: Optional[httpx.Client] = None,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._client = client
        self._owns_client = client is None

    def __enter__(self) -> "PeganaClient":
        if self._client is None:
            self._client = httpx.Client(timeout=self.timeout)
            self._owns_client = True
        return self

    def __exit__(self, *_exc: Any) -> None:
        if self._owns_client and self._client is not None:
            self._client.close()
            self._client = None

    def _http(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(timeout=self.timeout)
            self._owns_client = True
        return self._client

    def _get_json(self, path: str, params: Optional[dict[str, Any]] = None) -> Any:
        resp = self._http().get(
            f"{self.base_url}{path}",
            params=params,
            headers={"Accept": "application/json"},
        )
        resp.raise_for_status()
        return resp.json()

    def _get_json_or_none(
        self, path: str, params: Optional[dict[str, Any]] = None
    ) -> Any:
        """Like ``_get_json`` but returns ``None`` on a 404 instead of raising.

        Used by ``get_onchain``, where a 404 is the route's deliberate signal
        for every non-committed state (ADR-0004 / B-005), not an error.
        """
        resp = self._http().get(
            f"{self.base_url}{path}",
            params=params,
            headers={"Accept": "application/json"},
        )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()

    def get_audit(self, alert_id: str) -> dict[str, Any]:
        """GET /v1/audit/{id} — fetch the full receipt for an alert."""
        return self._get_json(f"/v1/audit/{alert_id}")

    def get_audit_index(
        self,
        limit: Optional[int] = None,
        exclude_pegged: Optional[bool] = None,
    ) -> list[dict[str, Any]]:
        """GET /v1/audit?limit=N — recent receipts, newest first."""
        params: dict[str, Any] = {}
        if limit is not None:
            params["limit"] = limit
        if exclude_pegged is not None:
            params["exclude_pegged"] = "true" if exclude_pegged else "false"
        return self._get_json("/v1/audit", params=params)

    def get_onchain(self, alert_id: str) -> Optional[dict[str, Any]]:
        """GET /v1/audit/{id}/onchain — Solana SPL Memo commitment.

        Returns ``None`` when the alert is NOT anchored — which the route
        reports as a 404 across every non-committed state (cost-gated /
        not_applicable, in-flight, retry_exhausted, wallet_drained, unknown).
        This is the COMMON case: SPL Memo commits are reserved for
        high-severity transitions (ADR-0004). A non-``None`` result is the
        live 200 body ``{ tx_sig, explorer_url, commit_status }`` with
        ``commit_status == "committed"``.
        """
        return self._get_json_or_none(f"/v1/audit/{alert_id}/onchain")

    def verify_alert(self, alert_id: str, expected_sha: str) -> VerifyResult:
        """Lightweight client-side sha256 check.

        For cryptographic replay (re-executing the methodology), use the
        ``pegana-replay`` CLI which exits non-zero on mismatch.

        ``/v1/audit/{id}`` returns ``{ alert, evidence, evidence_status }`` —
        the receipt sha is nested under ``evidence``. Prior to 2026-05-29
        this method read ``receipt["receipt_sha256"]`` at the top level,
        which was always missing, so every call returned ``ok=False``.
        """
        receipt = self.get_audit(alert_id)
        status = str(receipt.get("evidence_status", "unknown"))
        evidence = receipt.get("evidence") or {}
        actual = str(evidence.get("receipt_sha256", ""))
        return VerifyResult(
            # Only a READY receipt can be verified. A pending/failed receipt has
            # no sha yet (actual == "") — ok=False there is NOT a mismatch;
            # callers distinguish it via `status` rather than reading it as tamper.
            ok=status == "ready" and actual != "" and actual == expected_sha,
            status=status,
            expected=expected_sha,
            actual=actual,
            alert_id=alert_id,
        )


# Module-level convenience functions backed by a default client.
_default = PeganaClient()


def get_audit(alert_id: str) -> dict[str, Any]:
    return _default.get_audit(alert_id)


def get_audit_index(
    limit: Optional[int] = None,
    exclude_pegged: Optional[bool] = None,
) -> list[dict[str, Any]]:
    return _default.get_audit_index(limit=limit, exclude_pegged=exclude_pegged)


def get_onchain(alert_id: str) -> Optional[dict[str, Any]]:
    return _default.get_onchain(alert_id)


def verify_alert(alert_id: str, expected_sha: str) -> VerifyResult:
    return _default.verify_alert(alert_id, expected_sha)


__all__ = [
    "PeganaClient",
    "VerifyResult",
    "get_audit",
    "get_audit_index",
    "get_onchain",
    "verify_alert",
    "peg_feed",
    "DEFAULT_WS_URL",
]

__version__ = "0.3.0"
