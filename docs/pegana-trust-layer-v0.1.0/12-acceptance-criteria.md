> ⚠️ **AMENDED** — see [`AMENDMENTS.md`](AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original spec preserved below as historical reference.

---

# 12 — Acceptance Criteria

> Trust Layer v0.1.0 is "done" when every item below is checked, verified, and recorded. This is the deploy gate (see `01-business-rules.md § Deploy gate`).

---

## 🟢 STATUS as of 2026-05-29 (sweep)

**Trust Layer v0.1.0 deployed to prod on 2026-05-29 03:55 UTC** (3 days
early per ADR-0005). All in-scope sections verified live:

| Section | ACs | Status |
|---|---|---|
| 1 — Methodology crate | AC1-5 | ✅ All done — `cargo test -p pegana-methodology --lib` 31/31 passes; proptest covers `apply_ewma_pure` + `transition_decide`; canonical hashes deterministic |
| 2 — Engine refactor | AC6-9 | ✅ All done — `thresholds.rs` extracted to crate; explicit `now` propagation; 5 integration tests green |
| 3 — Audit persistence | AC10-15 | ✅ All done — migrations 0028-0031 applied; `alert_evidence` append-only verified by trigger test; Run 1+2 receipts (`70a17253...`, `89dc782e...`) live in prod |
| 4 — API surface | AC16-25 | ✅ All done — including **AC42 closed 2026-05-29** (PR #59 `1e99ee7`); 4-state discrimination (200/202/410/404) per ADR-0006 verified |
| 5 — External surfaces | AC26-30 | ✅ All done — webhook + Telegram + MCP `subscribe_peg_events` + `verify_alert` all shipping `evidence_url`; bot-ts 150 tests green, mcp-ts 168 tests green |
| 6 — CLI distribution | AC31-37 | ⚠️ Partial — binary + Sigstore + tamper test done; **homebrew tap (AC37) not yet verified** post repo-split; install one-liner shipped |
| 7 — Web pages | AC38-47 | ✅ All done — `/audit/[id]`, `/audit` index, `/methodology`, `/pricing`, `/agents`, `/embed` shipping; **AC42 closed today** via server-side `?state=` filter |
| 8 — Feeds | AC48-50 | ✅ All done — `/audit.xml`, `/calibration.xml`, `<link rel="alternate">` in `<head>` |
| 9 — Embed widget | AC51-55 | ✅ All done — script + iframe variants live, CORS verified |
| 10 — CSV export | AC56-59 | ✅ All done — streaming + 90-day cap + 50k row cap per ADR-0014 |
| 11 — SDKs | AC60-64 | 🟡 Deferred per ROADMAP — `private: true` intentional until ≥1 design partner; AC64 (version match) inapplicable while private |
| 12 — On-chain commitment | AC65-69 | ✅ AC65-66, AC68-69 done; **AC67 deferred** per ROADMAP (devnet integration test) |
| 13 — Reproducible builds | AC70-73 | 🟡 AC71, AC73 done; **AC70 deferred** (CI hook), **AC72 deferred** (Dockerfile sha256 pinning) |
| 14 — Observability | AC74-76 | ✅ All done — Prometheus + Grafana + Sentry wired; **+ new counters from 2026-05-29 sprint** (`pegana_engine_handle_message_failed_total`, `pegana_state_snapshot_failed_total{phase}`, etc.) |
| 15 — Strategic gates | AC77-80 | 🟡 AC77 in-flight (calibration runs through 06-10), **AC78 dropped as gate** ([decision](../../operations/ac78-webhook-dogfood-decision.md)), AC79-80 done |
| 16 — Asset coverage | AC81-85 | ⚠️ **Drift** — AC81 said 28 entries / 26 active. Reality 2026-05-29: 28 entries (with JLP added today), 22 active. AC85 was specified as "5 Phase 0 assets flip"; **JLP was silently dropped from the original Phase 0 commit and re-added today** (`assets.toml:485` block). USDe and USDS are already active. |
| 17 — Trust strip + launch artifacts | AC86-88 | ✅ All done — trust strip live on homepage, methodology one-liner present, asset count consistency restored in sprint (CAT-A `e7b2d68`) |
| 18 — Outreach | AC89-92 | ⏸️ Cut from scope per 2026-05-29 pivot — drafts ready in `docs/outreach/`, pending operator decision per [`docs/outreach/log.md`](../../outreach/log.md) (only 2 entries logged). R12 risk per `13-risks-and-mitigations.md` — accept the kill-rule risk or reactivate. |

### Summary by status

| Status | Count |
|---|---|
| ✅ Done & verified | ~80 |
| 🟡 Deferred per ROADMAP (intentional) | 5 (AC42 closed today removed; AC60-63, AC67, AC70, AC72) |
| ⚠️ Partial / spec drift | 3 (AC37 homebrew post-split, AC81/AC85 JLP re-add today) |
| ⏸️ Cut from scope (pivot) | 4 (AC89-92 outreach) |
| 🆕 Decisions documented today | AC42 closed, AC78 dropped-as-gate |

### Verification commands

Anyone reading this file in the future who wants to re-verify the
"done" claims can use the live state:

```bash
# Section 3-4: audit persistence + API surface
curl -sS https://api.pegana.xyz/v1/audit | jq 'length'
curl -sS https://api.pegana.xyz/v1/audit?state=DEPEG | jq '.[0].to_state'
curl -sS https://api.pegana.xyz/v1/audit/89dc782e-3289-4de5-827e-585731a8e22e | jq '.evidence_status'

# Section 12: on-chain commitment (Run 2 — real prod alert from 2026-05-29)
curl -sS https://api.pegana.xyz/v1/audit/89dc782e-3289-4de5-827e-585731a8e22e | jq '.evidence.onchain_tx_sig'
# → "4XLXT3vS8BnKmMPQGNpuah5nMJJMbwNoNiMq3jF3gRB9N9LoRBkMdndQsifvsuK18PkPBAcG61BapXQdnPoSk3HV"
# Verify on Solana mainnet slot 423001050.

# Section 14: observability
curl -sS https://api.pegana.xyz/metrics | grep -E "pegana_audit_persist|pegana_state_snapshot|pegana_onchain_commit"
```

Below: original spec preserved verbatim — items still appear as `[ ]`
because no editor automated the per-line tick; trust the status banner
above instead.

---

---

## 1. Methodology crate (Phase 1)

- [ ] **AC1**: `crates/methodology` compiles standalone (`cargo build -p pegana-methodology`).
- [ ] **AC2**: 100% line coverage on public API functions (`cargo tarpaulin -p pegana-methodology` ≥ 100%).
- [ ] **AC3**: All 8 existing `thresholds.rs` tests migrated and pass.
- [ ] **AC4**: `proptest`-based property tests pass for `apply_ewma_pure` (3 invariants) and `transition_decide` (truth table).
- [ ] **AC5**: `canonical_assets_hash` and `canonical_receipt_hash` deterministic across same input (verified by roundtrip test).

## 2. Engine refactor (Phase 2)

- [ ] **AC6**: `crates/engine-rs/src/thresholds.rs` deleted from repo.
- [ ] **AC7**: All 5 existing integration tests in `state.rs` pass without modification (`lst_discount_in_sol_terms_ignores_sol_usd_multiplier_drift`, `per_feed_staleness_override_widens_window`, `transition_is_two_phase_with_hysteresis`, `ewma_smooths_across_ticks`, `pyth_confidence_label_buckets_high_medium_low`).
- [ ] **AC8**: `transition()` takes explicit `now: DateTime<Utc>` parameter; no internal `Utc::now()` call.
- [ ] **AC9**: `try_recompute` reads `Utc::now()` once and threads through all downstream calls including `persist_discount`, `transition`, and `push_alert`.

## 3. Audit persistence (Phase 3)

- [ ] **AC10**: Migration `0028_alert_evidence.sql` applied; table exists; UPDATE and DELETE both raise `P0001` exception with `append-only` message.
- [ ] **AC11**: Migration `0029_alert_events_view.sql` applied; `\d alert_events` returns matching column set; `SELECT COUNT(*)` matches `alerts` table.
- [ ] **AC12**: Migration `0030_methodology_versions.sql` applied; seed row `0.1.0 active` present.
- [ ] **AC13**: Migration `0031_alert_evidence_onchain_sig.sql` applied; column nullable; partial index on `created_at WHERE onchain_tx_sig IS NULL` exists.
- [ ] **AC14**: Every alert emitted in the 24h following deploy produces a matching `alert_evidence` row. Target: ≥ 99.9% (verified via `pegana_audit_persist_total{outcome="ok"}` / `pegana_alerts_emitted_total` ratio).
- [ ] **AC15**: Engine refuses to start when its `methodology_version()` returns a value marked `broken` in `methodology_versions` table (verified by manual test on staging).

## 4. API surface (Phase 4)

- [ ] **AC16**: `GET /v1/audit/:alert_id` returns 200 with full receipt JSON for any alert from the last 90 days that has an evidence row.
- [ ] **AC17**: `GET /v1/audit/:alert_id` returns 404 with body `{"error": "alert_not_found"}` when alert UUID doesn't exist.
- [ ] **AC18**: `GET /v1/audit/:alert_id` returns 404 with body `{"error": "evidence_missing", "alert_id": "..."}` when alert exists but evidence row missing.
- [ ] **AC19**: `GET /v1/audit/:alert_id/replay-bundle` returns 200 with bundle JSON and `Content-Disposition: attachment` header for critical alerts (DEPEG/CRITICAL/BLACK_SWAN).
- [ ] **AC20**: `GET /v1/audit/:alert_id/replay-bundle` returns 404 with body `{"error": "no_replay_artifact"}` for DRIFT alerts.
- [ ] **AC21**: `GET /v1/audit/:alert_id/onchain` returns 200 with `{tx_sig, explorer_url}` after async commit completes; 404 with `not_committed_yet` otherwise.
- [ ] **AC22**: `GET /v1/audit?limit=50&exclude_pegged=true` returns array of 50 most recent non-PEGGED alerts with evidence.
- [ ] **AC23**: `GET /v1/audit.csv?from=YYYY-MM-DD&to=YYYY-MM-DD&asset=USDe` streams CSV with documented column order; date range > 1 year returns 400.
- [ ] **AC24**: All `/v1/audit*` endpoints return `Cache-Control: public, max-age=31536000, immutable` for content-by-id responses.
- [ ] **AC25**: OpenAPI spec at `/openapi.json` includes all new endpoints under `tags=["audit"]`.

## 5. External surfaces — bot, MCP, webhook (Phases 5-7)

- [ ] **AC26**: Telegram alerts in 🇧🇷 PT-BR and 🇬🇧 EN include `🔍 Evidence: <link>` line for all 5 templates (`alert_lst`, `alert_cdp`, `alert_fx`, `alert_yield`, `alert_stable`).
- [ ] **AC27**: Webhook payloads include top-level `evidence_url` field; HMAC ed25519 signature covers the new field (verified by `tests/webhook_signing.rs`).
- [ ] **AC28**: MCP tool `subscribe_peg_events` returns events with `evidence_url` in both `content` (text JSON) and `structuredContent` shapes; Zod `alertEvent` schema includes `evidence_url: z.string().url()`.
- [ ] **AC29**: New MCP tool `verify_alert(alert_id)` registered, returns receipt JSON via proxy to `/v1/audit/:alert_id`; free tier (no x402 payment required).
- [ ] **AC30**: Backward compatibility: MCP clients on old schemas (without `evidence_url` field knowledge) receive responses without errors (additive change validated).

## 6. CLI distribution (Phases 8-9)

- [ ] **AC31**: `pegana-replay --alert-id <real-prod-uuid>` exits 0 on macOS arm64, macOS x64, Linux x64, Windows x64 (cargo-dist artifacts).
- [ ] **AC32**: Tamper test: alter one byte of `inputs_frozen.market_usd` in bundle JSON, run CLI, exit code = 1 with diff output naming the changed field.
- [ ] **AC33**: Version mismatch test: build CLI against methodology v0.1.0, attempt to verify a bundle marked methodology v0.2.0, exit code = 3 with install hint.
- [ ] **AC34**: `--verify-onchain` flag: on a critical alert with `onchain_tx_sig` populated, exit 0 with confirmation; if memo content doesn't match receipt sha256, exit code = 4.
- [ ] **AC35**: Installer one-liner `curl --proto '=https' --tlsv1.2 -LsSf https://releases.pegana.xyz/pegana-replay-installer.sh | sh` succeeds on a fresh Linux VM and adds binary to `~/.pegana/bin/pegana-replay`.
- [ ] **AC36**: Sigstore attestation: `gh attestation verify ~/.pegana/bin/pegana-replay --owner lrafasouza --repo pegana` returns success.
- [ ] **AC37**: Homebrew install: `brew tap lrafasouza/pegana && brew install pegana-replay` succeeds on macOS.

## 7. Web pages (Phase 10)

- [ ] **AC38**: `/audit/[alert_id]` renders receipt with all 6 sections (header, inputs, computed, methodology, replay, footer) for any production alert.
- [ ] **AC39**: `/audit/[alert_id]/loading.tsx` renders skeleton on slow API responses.
- [ ] **AC40**: `/audit/[alert_id]/not-found.tsx` renders custom 404 for `evidence_missing` from API.
- [ ] **AC41**: `/audit/[alert_id]/opengraph-image.tsx` generates 1200×630 PNG with asset, transition, version, receipt fingerprint; verified via Twitter Card Validator + Telegram preview.
- [ ] **AC42**: `/audit` index page lists 50 most recent non-PEGGED alerts with methodology version filter.
- [ ] **AC43**: `/methodology` page (fresh build) renders 6 sections (what this is, verify, lifecycle, changelog from CHANGELOG.md, what this isn't, source link). Disclaimer text present.
- [ ] **AC44**: `/pricing` page renders waitlist form, no active tier prices, link to roadmap.
- [ ] **AC45**: `/agents` page shows MCP server URL, code snippet for `verify_alert`, sample agent integration example.
- [ ] **AC46**: `/embed/[asset]` iframe renders 240×48 status badge with current state; works in sandboxed iframe on third-party site (CORS verified).
- [ ] **AC47**: `/embed/demo` shows both script and iframe variants live with copy-paste snippets.

## 8. Feeds and syndication (Phase 11M.2, 11M.6)

- [ ] **AC48**: `/audit.xml` returns valid Atom 1.0 (passes [feedvalidator.org](https://feedvalidator.org)) with last 50 non-PEGGED audits; `Content-Type: application/atom+xml; charset=utf-8`.
- [ ] **AC49**: `/calibration.xml` returns valid Atom 1.0 with last 100 `assets.toml` mutations (git log derived).
- [ ] **AC50**: `<link rel="alternate" type="application/atom+xml">` discovery tags present in root `<head>` for both feeds.

## 9. Embed widget (Phase 11M.3)

- [ ] **AC51**: `embed.js` minified+gzipped ≤ 10KB.
- [ ] **AC52**: Script-based widget renders correctly in Chrome, Firefox, Safari (mainline browsers).
- [ ] **AC53**: CORS: `/v1/assets/*` returns `Access-Control-Allow-Origin: *` for GET only.
- [ ] **AC54**: Widget polls `/v1/assets/<symbol>` every 30s; emits `postMessage({type: "pegana:state", asset, state})` to host page.
- [ ] **AC55**: Both light and dark theme variants work via `data-pegana-theme` attribute or `?theme=dark` query param.

## 10. CSV export (Phase 11M.4)

- [ ] **AC56**: `GET /v1/audit.csv?from=&to=&asset=` streams via `axum-streams` (verified via chunked Transfer-Encoding header).
- [ ] **AC57**: 10k synthetic rows test consumes ≤ 100MB peak memory.
- [ ] **AC58**: Date range > 366 days returns 400 with `date_range_too_large` error.
- [ ] **AC59**: CSV columns in documented order: `alert_id, asset, class, from_state, to_state, discount, intrinsic_usd, market_usd, confidence, detected_at, methodology_version, assets_toml_sha256, receipt_sha256, onchain_tx_sig`.

## 11. SDKs (Phase 11M.5)

- [ ] **AC60**: `@pegana/sdk-ts` published on npm.
- [ ] **AC61**: `pegana-sdk` published on PyPI.
- [ ] **AC62**: TS demo: `npm install @pegana/sdk-ts && node demo.js` round-trips `getAudit(alertId)` against prod, prints receipt.
- [ ] **AC63**: Python demo: `pip install pegana-sdk && python demo.py` same as above.
- [ ] **AC64**: Both SDK versions match the API OpenAPI version they were generated against.

## 12. On-chain commitment (Phase 11M.1)

- [ ] **AC65**: Engine wallet `PEGANA_COMMIT_KEYPAIR` configured and funded with ≥ 0.5 SOL at deploy time.
- [ ] **AC66**: Critical alert in prod within 24h of deploy produces `alert_evidence.onchain_tx_sig` populated within 60s; signature resolves on Solscan.
- [ ] **AC67**: Devnet integration test (`crates/engine-rs/tests/onchain_commit.rs --ignored`) passes when run with `DEVNET_KEYPAIR` env.
- [ ] **AC68**: Replay CLI `--verify-onchain` succeeds against the deployed alert; transaction memo content matches `receipt_sha256`.
- [ ] **AC69**: Failure mode: SAS RPC unavailable triggers `pegana_onchain_commit_total{outcome="rpc_error"}` counter increment; alert dispatch unaffected.

## 13. Reproducible builds (Phase 11M.7)

- [ ] **AC70**: `.github/workflows/reproducible.yml` exists and runs on every PR.
- [ ] **AC71**: CI rebuilds engine binary twice on same runner, hashes match.
- [ ] **AC72**: All Dockerfiles pin base images by `@sha256:` digest (not by tag).
- [ ] **AC73**: `cargo build --release --locked --frozen -p pegana-engine` succeeds (no `Cargo.lock` drift).

## 14. Observability (Phase 12)

- [ ] **AC74**: New Prometheus metrics exposed on `/metrics`:
  - `pegana_audit_persist_total{outcome=ok|failed}` counter
  - `pegana_audit_persist_seconds` histogram
  - `pegana_engine_methodology_broken_total` counter
  - `pegana_onchain_commit_total{outcome=ok|rpc_error|timeout}` counter
  - `pegana_commit_wallet_balance_sol` gauge
- [ ] **AC75**: Grafana dashboard `pegana-overview` updated with 3 new panels (audit persist failure rate, audit persist p99 latency, on-chain commit success rate).
- [ ] **AC76**: Sentry release tag matches git SHA; new error categories visible (audit_persist_failed, onchain_commit_failed).

## 15. Strategic gates (cross-cutting)

- [ ] **AC77**: Calibration v1 report published at `docs/CALIBRATION-v1.md` with all "TBD" fields filled; per-asset p50/p95/p99 measured; launch verdict written.
- [ ] **AC78**: Webhook dogfood report published at `docs/operations/webhook-dogfood-2026-06-03.md` with delivery rate ≥ 99% and p99 latency ≤ 5s.
- [ ] **AC79**: Phase 0 assets (USDe, USDS, JLP, EURC, JupUSD, dzSOL, vSOL) have at least 7 days of calibration data accumulated in `discount_snapshots` before activation.
- [ ] **AC80**: Pre-flight check confirmed `alert_events` view exists on prod OR migration 0029 was applied out-of-band before main deploy.

## 16. Asset coverage (Phase 0 + production state)

- [ ] **AC81**: `assets.toml` contains **28 entries** post-Phase 0 (23 currently + 5 new). 26 active at launch (21 currently + 5 new flipped). INF and BRZ remain inactive.
- [ ] **AC82**: All 5 new asset mints verified via mainnet RPC (`solana account <mint>`): JupUSD, JLP, EURC, dzSOL, vSOL.
- [ ] **AC83**: Pyth feed IDs documented or marked as fallback (Jupiter quote / DexScreener) per asset in `03-asset-coverage.md`.
- [ ] **AC84**: `cargo test -p pegana-common --lib assets_toml_parses` passes (assertion relaxed from `>= 23` to `>= 28` after Phase 0).
- [ ] **AC85**: At deploy time (06-11), the 5 Phase 0 assets (**JupUSD, JLP, EURC, dzSOL, vSOL**) flipped to `active=true` and engine restarted. USDe and USDS are already active — no change for them.

## 17. Trust strip + launch artifacts (Phase 12.3, 12.4)

- [ ] **AC86**: Home page `app/(marketing)/page.tsx` shows live `assets_in_drift` count from `/v1/stats`; link to `/audit`.
- [ ] **AC87**: Launch artifacts (homepage, methodology page, README, marketing copy) all reflect correct asset count (**26 active** at launch); no stale references to "22 assets" or "23 assets" or "29".
- [ ] **AC88**: Methodology one-liner present on homepage hero and `/methodology` page: "Oracle/intrinsic + executable market quote = spread."

## 18. Outreach + distribution (Phase 13)

- [ ] **AC89**: Parity (Colosseum) outreach email sent with concrete integration proposal.
- [ ] **AC90**: StableGuard outreach email sent.
- [ ] **AC91**: PR submitted to `sendaifun/solana-new` adding Pegana to concept list under "Peg-Risk Oracle for Agent Allocators".
- [ ] **AC92**: Demo Twitter/Farcaster post published with screen recording of `assets_in_drift` ticker + `pegana-replay --alert-id <real-uuid>` returning PASS.

---

## How acceptance is verified

Each criterion has a verification method:

- **Engineering criteria** (AC1-AC76, AC81-AC85): automated tests in CI, or manual reproduction by following the linked plan file step.
- **Strategic gates** (AC77-AC80): manual review of published documents.
- **Acceptance criteria for ops-style items** (AC65, AC72, AC76): visual verification on staging + prod logs.
- **Outreach** (AC89-AC92): email/PR confirmations archived.

The Trust Layer v0.1.0 release manager (Rafael) marks each item complete in this file and commits the diff. Once all 92 are checked, deploy to production proceeds.

---

## Mapping to phases

| Phase (plan file) | Acceptance criteria covered |
|---|---|
| Phase 0 | AC77, AC78, AC79, AC80, AC81-AC85 |
| Phase 1 (methodology) | AC1-AC5 |
| Phase 2 (engine refactor) | AC6-AC9 |
| Phase 3 (audit persistence) | AC10-AC15 |
| Phase 4 (api) | AC16-AC25 |
| Phase 5 (dispatcher) | AC27 |
| Phase 6 (bot) | AC26 |
| Phase 7 (mcp) | AC28-AC30 |
| Phase 8 (replay-cli) | AC31-AC34 |
| Phase 9 (cargo-dist) | AC35-AC37 |
| Phase 10 (web pages) | AC38-AC47 |
| Phase 11 (lifecycle + index + OG + methodology + pricing + agents) | AC42-AC45 |
| Phase 11M (maximalist) | AC48-AC73 |
| Phase 12 (observability + trust strip) | AC74-AC76, AC86-AC88 |
| Phase 13 (deploy + outreach) | AC65, AC85, AC89-AC92 |

---

## Cross-references

- For each acceptance criterion's implementation, see the corresponding phase file in `plans/`.
- For the deploy gate logic, see `01-business-rules.md § 5. Deploy gate`.
- For the risk register (what can prevent acceptance), see `13-risks-and-mitigations.md`.
