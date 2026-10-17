"""Smoke tests for the OpenAPI-generated client (``pegana_api_client``).

Structural checks always run (imports + client construction + the standard
sync/sync_detailed surface). A live end-to-end call against api.pegana.xyz runs
only when ``PEGANA_SDK_LIVE=1`` so offline/CI stays hermetic. The v0.1
receipt-surface regressions live in ``test_sdk.py`` (unchanged).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Make the package importable when run directly (pytest handles rootdir itself).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_generated_client_imports_and_constructs() -> None:
    from pegana_api_client import AuthenticatedClient, Client
    from pegana_api_client.api.assets import list_assets

    client = Client(base_url="https://api.pegana.xyz")
    assert client is not None
    # Bearer auth for the /v1/me/* surface (token via POST /v1/auth/telegram).
    authed = AuthenticatedClient(base_url="https://api.pegana.xyz", token="jwt-abc")
    assert authed is not None
    # Every generated endpoint exposes the standard call surface.
    assert callable(list_assets.sync)
    assert callable(list_assets.sync_detailed)


def test_full_endpoint_coverage_present() -> None:
    """The generated `api` package covers every tag group (not just audit)."""
    import pegana_api_client.api as api_pkg

    api_dir = Path(api_pkg.__file__).resolve().parent
    tags = {p.name for p in api_dir.iterdir() if p.is_dir() and not p.name.startswith("_")}
    for expected in ("assets", "alerts", "audit", "peg", "me", "methodology", "auth"):
        assert expected in tags, f"missing api tag group: {expected} (have {sorted(tags)})"


def test_live_list_assets() -> None:
    """PEGANA_SDK_LIVE=1: hit real api.pegana.xyz and decode the typed envelope."""
    if os.environ.get("PEGANA_SDK_LIVE") != "1":
        return  # gated — skip offline/CI
    from pegana_api_client import Client
    from pegana_api_client.api.assets import list_assets

    with Client(base_url="https://api.pegana.xyz") as client:
        result = list_assets.sync(client=client)
    # ApiListAssetCard envelope: a `.data` list of typed AssetCard rows.
    assert result is not None
    assert hasattr(result, "data")
    assert isinstance(result.data, list)
    assert len(result.data) > 0


if __name__ == "__main__":
    # stdlib fallback runner (mirrors test_sdk.py) so `python tests/test_generated.py`
    # works even without pytest installed.
    test_generated_client_imports_and_constructs()
    test_full_endpoint_coverage_present()
    test_live_list_assets()
    print("ok")
