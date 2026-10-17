> ⚠️ **AMENDED** — see [`AMENDMENTS.md`](AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original spec preserved below as historical reference.

---

# 13 — Risks and Mitigations

> Risk register for Trust Layer v0.1.0. Each item: likelihood × impact, mitigation in place or planned, and trigger for re-evaluation.

---

## 1. Risk matrix

| # | Risk | Likelihood | Impact | Composite | Status |
|---|---|---|---|---|---|
| R1 | Engine refactor breaks existing alert path | Medium | High | High | Mitigated (Section 2) |
| R2 | Receipt hash divergence cross-architecture | Low | Critical | Medium | Mitigated (Section 3) |
| R3 | `replay_artifact` accidentally captures secrets | Low | Medium | Low | Mitigated (Section 4) |
| R4 | `assets.toml` formatting change → hash change | Medium | Medium | Medium | Mitigated (Section 5) |
| R5 | `alert_evidence` insert fails silently | Low | High | Medium | Mitigated (Section 6) |
| R6 | Methodology version mismatch confuses users | Medium | Low | Low | Mitigated (Section 7) |
| R7 | `alert_events` view missing on prod | High | Medium | High | Mitigated (Phase 0 pre-flight) |
| R8 | End user installs CLI from wrong source | Low | High | Medium | Mitigated (Sigstore + sha256) |
| R9 | SAS commit fails for sustained period | Medium | Medium | Medium | Mitigated (Section 9) |
| R10 | Calibration v1 verdict = "tune" or "extend" | Medium | High | Medium | Calendar slips; mitigated (Section 10) |
| R11 | Engine wallet drained | Low | Medium | Low | Mitigated (gauge alert) |
| R12 | Trust Layer ships but no one verifies | Medium | Medium | Medium | Marketing dependent (Section 12) |

---

## 2. R1 — Engine refactor breaks existing alerts

**Description**: `state.rs::transition` signature change (adds `now` parameter) + `apply_ewma` delegation could introduce subtle regressions. The engine processes 21 → 26 active assets in production; a regression is silent until alerts misfire.

**Mitigation**:
- All 5 existing integration tests in `state.rs` MUST pass without semantic modification:
  - `snapshot_none_until_both_inputs_arrive`
  - `ewma_smooths_across_ticks`
  - `transition_is_two_phase_with_hysteresis` (only signature update — adds `now` arg)
  - `pyth_confidence_label_buckets_high_medium_low`
  - `stale_pyth_reading_is_refused`
- New test added: `transition_with_explicit_now_matches_old_implicit_now` — runs both code paths against same inputs, asserts identical output.
- Phase 2 gate: no merge to main if any of the 5 tests fail.
- Deploy gate: dogfood window catches regression in real production data BEFORE 06-11.

**Trigger for re-evaluation**: any test failure during Phase 2 implementation.

---

## 3. R2 — Receipt hash differs across architectures

**Description**: `Decimal` serialization, JSON canonicalization, or float rounding could produce different `receipt_sha256` on different CPU architectures (x86_64 vs aarch64), defeating the entire point of replay.

**Mitigation**:
- `Decimal` ALWAYS serialized as JSON string (e.g., `"0.987432"`), never as JSON number. No IEEE 754 ambiguity possible.
- `serde_json_canonicalizer` v0.3 used (RFC 8785-compliant, actively maintained Feb 2026). Avoids the abandoned `serde_jcs` which diverges from RFC on number representation.
- CI reproducibility check (`.github/workflows/reproducible-build.yml`) confirms same-machine bit-for-bit.
- Future: cross-runner test (Linux x64 vs macOS arm64) to verify receipt hash matches across platforms — deferred to v0.2.0.

**Trigger**: any cross-runner CLI test FAIL on a clean bundle. Indicates serialization drift.

---

## 4. R3 — `replay_artifact` captures secrets

**Description**: If sensitive data (API keys, RPC URLs, internal env values) inadvertently flow into `inputs_frozen` or `assets_toml_canonical`, they'd be embedded in the public `replay_artifact` JSONB.

**Mitigation**:
- `InputsFrozen` struct is type-safe: only the documented fields can be serialized. New fields require code change + review.
- `assets_toml_canonical` is the canonicalized form of `assets.toml`. This file is git-tracked, public, and has no secrets by convention.
- No env var values flow into the methodology layer — env reads happen at engine startup, not in the per-alert hot path.
- Pre-deploy: grep `replay_artifact` JSONB samples for known secret patterns (Helius API keys, Telegram tokens, Postgres passwords).

**Trigger**: ANY field added to `InputsFrozen` requires explicit review for secret leakage.

---

## 5. R4 — `assets.toml` formatting change → hash change

**Description**: A whitespace-only edit to `assets.toml` (e.g., reformatting via `taplo`, comment changes, trailing newlines) could change the `assets_toml_sha256` without changing semantic content, making old receipts look like they referenced a "different config".

**Mitigation**:
- `canonical_assets_hash` parses TOML → re-serializes in canonical form → hashes. Comments and whitespace ignored.
- Test: `canonical_assets_hash("[[assets]]\nsymbol = \"USDC\"\n# comment\n") == canonical_assets_hash("[[assets]]\nsymbol = \"USDC\"\n")` — passes.
- However: a key order change (e.g., adding `pyth_feed_id` before `intrinsic`) WILL change canonical serialization → WILL change hash. This is correct behavior — semantic content changed (config structure).

**Trigger**: any complaint about "hash mismatch" after a non-semantic `assets.toml` edit. Investigate via diff of canonical form.

---

## 6. R5 — `alert_evidence` insert fails silently

**Description**: A transient DB error during `alert_evidence` INSERT. The alert is still dispatched (per spec), but the audit row is missing → `/v1/audit/<id>` returns `evidence_missing`. If not noticed operationally, a partner asks "where's the receipt?" and credibility erodes.

**Mitigation**:
- `pegana_audit_persist_total{outcome="failed"}` counter increments.
- Sentry captures the `error!` log with full alert_id context.
- Grafana panel A alerts ops within 5 minutes of the FIRST failure.
- Replay path: from log + alert_id, ops can manually `INSERT INTO alert_evidence` with the recovered values if needed.
- SLO: 99.9% — single-digit failures per million alerts acceptable.

**Trigger**: SLO breach for 30 days OR Grafana panel A alert.

---

## 7. R6 — Methodology version mismatch in CLI

**Description**: User installs `pegana-replay-cli` v0.2.0 (latest), tries to verify an alert emitted by v0.1.0. CLI refuses with exit code 3. User is confused.

**Mitigation**:
- CLI prints actionable error message:
  ```
  VERSION_MISMATCH: alert uses methodology v0.1.0; this CLI is v0.2.0.
  Install the matching version:
    cargo install pegana-replay-cli --version 0.1.0
  ```
- `/methodology` web page documents version pinning clearly.
- Web `/audit/[alert_id]` "Replay" section shows the install command with the right version.
- Future: CLI auto-installs the right version (out of scope v0.1.0).

**Trigger**: user reports confusion. Then improve copy.

---

## 8. R7 — `alert_events` view missing on prod

**Description**: MCP `subscribe_peg_events` queries `alert_events`, but no migration creates it. Could be silently broken on prod right now. Migration 0029 codifies it, but if missing on prod, MCP is already failing.

**Mitigation**:
- Phase 0.1 pre-flight: SSH to prod, run `\d+ alert_events`. If exists, migration 0029 is no-op. If missing, apply migration 0029 IMMEDIATELY (out of band) to fix MCP.
- Document findings in `docs/operations/pre-deploy-notes-trust-layer.md`.
- Acceptance criterion AC80 explicitly gates deploy on this confirmation.

**Trigger**: Phase 0.1 finding. Investigated and resolved before any further work.

---

## 9. R8 — End user installs malicious CLI

**Description**: Attacker hijacks `releases.pegana.xyz` DNS or compromises the install script to ship a backdoored `pegana-replay` binary that always returns PASS regardless of input.

**Mitigation**:
- `releases.pegana.xyz` is a Caddy CNAME proxy in front of GitHub Releases. Compromising the mirror requires compromising both Cloudflare DNS AND Caddy on Hetzner — two distinct attack surfaces.
- Cargo-dist publishes sha256 checksums for every binary in the release manifest. Installer script verifies checksum before executing.
- **Sigstore attestation** via `github-attestations = true`: every binary has an OIDC-keyless certificate from GitHub Actions proving it was built by the official workflow. End user runs `gh attestation verify ~/.pegana/bin/pegana-replay --owner lrafasouza --repo pegana` to confirm.
- `/methodology` page documents the verification flow explicitly.

**Trigger**: report of unexpected `pegana-replay` behavior. Investigate provenance via attestation.

---

## 10. R9 — SAS commit fails for sustained period

**Description**: Solana RPC unavailable, wallet drained, network congestion, etc. New critical alerts don't get `onchain_tx_sig` populated. Audit page shows `not_committed_yet` indefinitely. Trust posture degrades.

**Mitigation**:
- `tokio::spawn` fire-and-forget — alert dispatch is unaffected.
- `pegana_onchain_commit_total{outcome=rpc_error|timeout}` counter → Grafana panel C → ops alert if < 80% for 30 min.
- Wallet balance gauge `pegana_commit_wallet_balance_sol` → alert at < 0.5 SOL.
- Retry strategy in CLI commit (currently single attempt with 60s timeout; v0.2.0 may add exponential backoff up to 1h).
- Fallback: if SAS specifically broken (e.g., SAS contract migration), engine falls back to SPL Memo (raw text receipt). Lower semantic richness but same proof-of-existence.

**Trigger**: 30-min outage of SAS commit success rate.

---

## 11. R10 — Calibration v1 verdict ≠ "ship"

**Description**: Per `01-business-rules.md § Deploy gate`, deploy requires `CALIBRATION-v1.md` verdict = "ship" on 06-10. If verdict = "tune" or "extend dogfood", Trust Layer launch slips.

**Mitigation**:
- Phase 0.5 (calibration report) is the FINAL gate. Ops review threshold deltas, classify alerts, write verdict.
- If "tune": adjust thresholds in `assets.toml`, run another 7-day mini-calibration. Trust Layer ship slips to 06-17 minimum.
- If "extend dogfood": full 14-day window restarts. Slip to 06-24 minimum.
- Trust Layer work proceeds in PARALLEL during this period — code can be merged to a feature branch awaiting the gate.
- Phase 14 (backtest) and Phase 15 (pricing) slip proportionally.

**Trigger**: 06-10 verdict ≠ "ship". Re-plan affected phases.

---

## 12. R11 — Engine wallet drained

**Description**: At 5000 lamports per SAS commit × 50 critical alerts/month = 250k lamports/month ≈ $0.025/month. Wallet should last YEARS on a single 0.5 SOL deposit. But: gas spikes, accidental key reuse, malicious drain.

**Mitigation**:
- Pegana wallet pubkey documented at `/methodology#on-chain-anchor`. Anyone can verify balance via Solscan.
- `pegana_commit_wallet_balance_sol` gauge with alert at < 0.5 SOL.
- Keypair stored as Docker secret (chmod 600 file). NOT in git, NOT in env directly (only path to keyfile via env).
- Operator runbook: refund procedure documented in `docs/operations/sas-wallet-refund.md`.
- Future: hardware-wallet-backed signing (out of scope v0.1.0).

**Trigger**: balance < 0.5 SOL gauge alert OR spike in commit failures with "insufficient funds" error.

---

## 13. R12 — Trust Layer ships but no one verifies

**Description**: Solo founder builds verifier infrastructure. Skeptics could care less. Partners (Parity, StableGuard) don't ask for verifiability. Effort is wasted.

**Mitigation**:
- Outreach Phase 13.3-13.6 EXPLICITLY targets entities for whom verifiability matters:
  - Parity (Colosseum) — settles prediction markets, needs trustworthy state oracle
  - StableGuard — insurance payouts gated by trustworthy depeg detection
  - SendAI — agent ecosystem builders care about auditable signals for agent decisions
- `/audit.xml` RSS feed exposes audits to journalist/researcher pipelines.
- Twitter/Farcaster demo (Phase 13.6) shows live `assets_in_drift` count + `pegana-replay --alert-id` running. Visual proof, distributable.
- Embed widget (`embed.js`) gives partners a low-friction way to display Pegana status on their dashboards — exposes Pegana brand to their users.

**Trigger**: 30 days post-launch with < 5 unique CLI installs (measurable via cargo-dist download analytics? or self-reported via web). Then pivot marketing approach.

---

## 14. Roadmap items (deferred risks)

Things known to be missing in v0.1.0, scheduled for v0.2.0+:

| Item | Why deferred | When |
|---|---|---|
| Cross-architecture reproducible builds (Nix-level) | Significant tooling effort | v0.2.0 (Q3 2026) |
| Solana Attestation Service proper (vs SPL Memo fallback) | Requires schema registration + 1-2 days work | v0.2.0 |
| Hardware-wallet signing for engine commit | Increases ops complexity | v0.3.0+ when partner demand validates |
| Multi-language audit page (PT-BR) | i18n stack | Sub-project D |
| Audit log retention beyond 1 year | Storage growth modeling | Re-evaluate at 1 GB cumulative |
| Per-asset methodology override | Adds complexity | Only if partner demands |
| Statistical drift detection on methodology output | Requires baseline data | 6 months post-launch |
| Migration of from SPL Memo to SAS schema for richer attestations | See above | v0.2.0 |

Each row tracked in `docs/superpowers/roadmap.md` (existing or new).

---

## 15. Risk-related testing

| Risk | Test type | File |
|---|---|---|
| R1 | Integration regression | `crates/engine-rs/tests/*.rs` (all existing) |
| R2 | Property test for canonical hash determinism | `crates/methodology/src/canonical.rs::tests` |
| R3 | grep audit JSON for secret patterns | Manual pre-deploy |
| R4 | Canonical hash stability test | `crates/methodology/src/canonical.rs::tests` |
| R5 | Synthetic persist-failure test | `crates/engine-rs/tests/audit_persistence.rs` |
| R6 | CLI version-mismatch test | `crates/pegana-replay-cli/tests/replay.rs` |
| R7 | Pre-flight Postgres `\d alert_events` | Manual Phase 0.1 |
| R8 | Sigstore verify test | Manual CLI test post-install |
| R9 | Devnet SAS round-trip | `crates/engine-rs/tests/onchain_commit.rs --ignored` |
| R10 | Calibration verdict review | Manual Phase 0.5 |
| R11 | Balance gauge alert simulation | Grafana panel test |
| R12 | Marketing engagement metrics | Post-launch ongoing |

---

## 16. Cross-references

- For mitigations in the architecture, see `02-architecture.md § Failure modes`.
- For the deploy gate logic, see `01-business-rules.md § 5. Deploy gate`.
- For observability of risk indicators, see `11-observability.md`.
- For outreach plan, see `01-business-rules.md § 6. Outreach posture` + `plans/13-phase-13-deploy-outreach.md`.
