# Changelog

All notable changes to `pegana-sdk`. The package follows semver; while it is
below 1.0.0, a breaking change bumps the minor version.

## 0.4.0 (unreleased)

`pegana_api_client` is regenerated from the current OpenAPI spec at
<https://api.pegana.xyz/openapi.json>.

### Breaking

- Code that constructs `LoopExposureResponse`, `SystemicSignal` or `StateResp`
  itself (Python constructors) must now pass the new required fields:
  `cascade_coverage` on the first two, `since_is_lower_bound` on `StateResp`.
- Requires Python 3.11 or later (`requires-python = ">=3.11"`; the 3.10
  classifier is dropped). The generated `pegana_api_client` models import
  `Self` from `typing`, which only exists from Python 3.11, so importing them on
  3.10 already failed with `ImportError` in 0.3.0. The old `>=3.10` metadata
  was wrong; 0.4.0 states the real floor.

The API no longer serves these endpoints, so their generated modules and models
are gone. Calls to them got `404 not_found` from the live API; imports of them
now fail with `ModuleNotFoundError` instead:

- `pegana_api_client.api.alerts` (`GET /v1/alerts`). Use the public receipt
  ledger, `pegana_api_client.api.audit.index` (`GET /v1/audit`).
- `pegana_api_client.api.auth` (`/v1/auth/*`).
- `pegana_api_client.api.me` (`/v1/me`, `/v1/me/alerts`, `/v1/me/preferences`).
- `pegana_api_client.api.subscriptions` (`/v1/me/subs*`).
- `pegana_api_client.api.webhooks` (`/v1/me/webhooks*`).
- The models that only those endpoints used, among them `AlertRow`,
  `ApiListAlertRow`, `Me`, `UserView`, `SubView`, `Webhook`, `DeliveryRow`,
  `LoginPayload` and `LoginResponse`.

### Added

- `audit.index` keyword arguments for cursor paging and filtering: `asset`,
  `since`, `until`, `before`, `before_id`. `state` also accepts `UNKNOWN`.
- `cascade_updated_at` on the `LoopExposureResponse` and `SystemicSignal`
  models.
- `cascade_coverage` on the `LoopExposureResponse` and `SystemicSignal`
  models.
- `history_start` on the asset state, asset card and history models, and
  `since_is_lower_bound` on the asset state model.
- `discount_raw` on the `AssetCard` and `PegSignal` models.
- `market_unavailable` as a documented `state_reason` value (no discount
  snapshot in the last 15 minutes).
- Typed `400` (`ApiError`) responses on the asset detail, asset state,
  loop-exposure, by-mint detail, by-mint state and by-mint peg feed
  operations, and on the asset list (that one since 0.3.1).
- `/v1/ws` responses: a typed `400` `ws_upgrade_required`, a new `503`
  `ws_capacity`, and the `403` and `429` bodies are now `ApiError`.
- `AssetCard` fields `holder_count`, `liquidity_usd`, `market_context_at`,
  `market_depth` and `volume_24h_usd`, and the new `MarketDepth` and
  `MarketDepthComponents` models (added since 0.3.1).
- The health `live` operation has a typed `500` response.
- `assets.history` (`GET /v1/assets/{symbol}/history`) parses a `404`
  (`unknown_asset`) into `ApiError`.

### Changed

- Docstrings follow the current spec text (discount sign, UNKNOWN state,
  `discount_bps` rounding).
- Package metadata: Source and Changelog URLs added, and Issues now points at
  <https://github.com/PeganaHQ/Pegana/issues>.
- `pegana_sdk.__version__` is `0.4.0`.

## 0.3.0

- `pegana_sdk` and `pegana_api_client` ship as one package, `pegana-sdk`.
  Classifier cleanup. First release on PyPI.
