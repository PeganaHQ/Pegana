# ADR 0013 — Make `assets.toml` epochs visible in UI

**Status**: Accepted (2026-05-28)
**Context**: Trust Layer v0.1.0; receipt hash cascade across `assets.toml` changes

## Problem

Every receipt hashes `assets_toml_canonical` as one of its inputs (see
`05-methodology-crate.md § canonical_receipt_hash`). When you add an
asset (Phase 0 adds 5 today; future asset additions are routine), the
canonical TOML changes and every subsequent receipt has a different
`assets_toml_sha256` than every previous receipt.

Replay still works (each receipt embeds its own canonical TOML), but the
UI presents this opaquely. A skeptic comparing two receipts of USDe from
2026-06-15 and 2026-07-20 sees different "snapshot hashes" and may
conclude the methodology changed when only the asset list did.

## Decision

Make the assets.toml change history a first-class concept exposed to
users.

### Per-receipt display
- `/audit/[id]` shows `assets_toml_sha256` short form (first 7 hex chars)
  next to the methodology version.
- Tooltip: "Assets snapshot — changes when assets are added/removed.
  Does not change methodology behavior."
- Linked to the corresponding entry on `/methodology#assets-history`.

### Assets-history timeline on `/methodology`
- New section `/methodology#assets-history`.
- Rendered at build time from `git log assets.toml`:
  ```
  2026-05-28 — added JupUSD, JLP, EURC, dzSOL, vSOL (Phase 0)
              snapshot: a3f8c91
  2026-04-15 — activated USDe (was inactive)
              snapshot: 7b21e44
  ...
  ```
- Each entry links to the git commit.

### Receipt comparison page (deferred to Phase 15)
- Out of scope for v0.1.0 — but the data model supports it for future
  `/audit/compare?a=<id1>&b=<id2>` rendering.

### Calibration feed entry on assets.toml change
- `/calibration.xml` (existing) gets an item per commit that touches
  `assets.toml`, with diff summary.

## Why visible epochs vs hide the complexity

- Hiding the snapshot field makes the receipt feel like a black box;
  showing it is consistent with the trust pitch.
- Users who care about reproducibility will compare receipts and need to
  understand why hashes differ — better to explain in product than to
  field support questions.
- One-time UI cost; recurring benefit for every asset addition (which
  happens monthly post-launch).

## Consequences

- +1 component on `/audit/[id]` rendering the snapshot badge + tooltip.
- +1 section on `/methodology` (parses git log at build time).
- +1 entry in `/calibration.xml` per assets.toml commit.
- +0.5 task in Phase 10 and Phase 11 (web pages).

## Cross-refs

- `docs/pegana-trust-layer-v0.1.0/05-methodology-crate.md § canonical hashing`
- `docs/pegana-trust-layer-v0.1.0/09-web-pages.md § /audit/[id], /methodology`
- `docs/pegana-trust-layer-v0.1.0/plans/10-phase-11-lifecycle-index-og.md`
