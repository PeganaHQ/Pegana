# Changelog

All notable changes to `@peganahq/sdk-ts`. The package follows semver; while it
is below 1.0.0, a breaking change bumps the minor version.

## 0.4.0 (unreleased)

Regenerated from the current OpenAPI spec at <https://api.pegana.xyz/openapi.json>.

### Breaking

- Code that constructs `LoopExposureResponse`, `SystemicSignal` or `StateResp`
  itself (TypeScript object literals) must now pass the new required fields:
  `cascade_coverage` on the first two, `since_is_lower_bound` on `StateResp`.
The API no longer serves these paths, so the generated `paths` type no longer
contains them. Code that called them got `404 not_found` from the live API and
now fails at compile time instead:

- `GET /v1/alerts`. Use the public receipt ledger, `GET /v1/audit`.
- `/v1/auth/logout`, `/v1/auth/magic/consume`, `/v1/auth/magic/mint`,
  `/v1/auth/telegram`.
- `/v1/me`, `/v1/me/alerts`, `/v1/me/preferences`, `/v1/me/subs`,
  `/v1/me/subs/{asset}`, `/v1/me/webhooks`, `/v1/me/webhooks/{id}`,
  `/v1/me/webhooks/{id}/deliveries`, `/v1/me/webhooks/{id}/replay`,
  `/v1/me/webhooks/{id}/test`.

### Added

- `GET /v1/audit` query parameters for cursor paging and filtering: `asset`,
  `since`, `until`, `before`, `before_id`. `state` also accepts `UNKNOWN`.
- `cascade_updated_at` on the `LoopExposureResponse` and `SystemicSignal`
  schemas.
- `cascade_coverage` on the `LoopExposureResponse` and `SystemicSignal`
  schemas.
- `history_start` on the asset state, asset card and history schemas, and
  `since_is_lower_bound` on the asset state schema.
- `discount_raw` on the `AssetCard` and `PegSignal` schemas.
- `market_unavailable` as a documented `state_reason` value (no discount
  snapshot in the last 15 minutes).
- Typed `400` (`ApiError`) responses on the asset detail, asset state,
  loop-exposure, by-mint detail, by-mint state and by-mint peg feed
  operations, and on the asset list (that one since 0.3.1).
- `/v1/ws` responses: a typed `400` `ws_upgrade_required`, a new `503`
  `ws_capacity`, and the `403` and `429` bodies are now `ApiError`.
- `AssetCard` fields `holder_count`, `liquidity_usd`, `market_context_at`,
  `market_depth` and `volume_24h_usd`, and the new `MarketDepth` and
  `MarketDepthComponents` schemas (added since 0.3.1).
- The health `live` operation has a typed `500` response.
- `GET /v1/assets/{symbol}/history` has a typed `404` response (`ApiError`,
  `unknown_asset`: the symbol was never in the tracked universe).
- The `GET /v1/audit/{alert_id}/replay-bundle` 404 response is typed as
  `ApiError` instead of an empty body.

### Changed

- Schema descriptions follow the current spec text (discount sign, UNKNOWN
  state, `discount_bps` rounding).
- `createPeganaApi` trims trailing slashes from `baseUrl` with a linear scan
  instead of the `/\/+$/` regex (CodeQL js/polynomial-redos). Same result.
- Package metadata: `repository` now points at
  <https://github.com/PeganaHQ/Pegana> (`sdk/typescript`), and `bugs` at
  <https://github.com/PeganaHQ/Pegana/issues>.

## 0.3.1 (2026-07-30)

- Fixed the package entry points: 0.3.0 published `src/*.ts` paths, so importing
  it from `node_modules` failed. 0.3.1 points `main`, `types` and `exports` at
  the built `dist/`.

## 0.3.0

- First release under the `@peganahq` npm scope.
