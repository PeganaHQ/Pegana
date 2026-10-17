# Grant STBR — Delivery (M2 + M3 + weekly updates) — Design / Spec

> **Status:** approved 2026-06-30 (3 founder decisions locked below). NOT implemented.
> **Deadline:** 2026-07-31. **Milestones are self-described.** Weekly community updates required.
> **Payout wallet (USDG):** `EAfKRjgLGWma3N4pE51ZMdbVpoWmSHALKgmHWKPodjnw`. **Inbox:** `rafael@pegana.xyz`.

**Goal:** Close the remaining Superteam-Brazil/Solana-Foundation grant deliverables — publish `pegana-replay` to crates.io + its public source repo, ship the "verify in 60s" guide and the builder guide, and run the weekly community updates — without building any new product feature (ADR-0007 freeze respected).

**Architecture:** All three deliverables are **publish/docs work over already-built, already-validated code.** No methodology change (stays 0.4.0 so existing receipts verify byte-exactly). No new assets. No new web UI.

**Tech stack:** Rust workspace crates (publish via `cargo publish`), GitHub public mirror repo, cargo-dist+Sigstore (already live for binaries), Markdown docs, existing `crates/api-rs/src/openapi.rs` + `docs/spec.html`, existing `web/components/organisms/receipt-verifier.tsx` (in-browser verifier, live).

---

## Context — what's already done (verified 2026-06-30)

- **M1 (peg feed + `anchor` + reference adapter): ✅ DONE + LIVE.** `/v1/assets` (63 assets) exposes `anchor`/`risk_side`/`state_reason`; reference adapter shipped.
- **M2 browser-verify: ✅ LIVE** (`receipt-verifier.tsx` / `verify-receipt.ts`, byte-exact pure-JS).
- **M3 coverage: ✅ 63 ≥ 40**, FX present (BRZ→BRL, EURC→EUR, both `class=stable_fx`).
- **Binary distribution: ✅ LIVE** (cargo-dist + Sigstore on GitHub Releases via `releases.pegana.xyz/pegana-replay-installer.sh`).

What remains: **crates.io publish (M2a)**, **verify-60s guide (M2c)**, **builder guide (M3)**, **weekly updates**.

## Locked decisions (founder, 2026-06-30)
1. **Rename the published package `pegana-replay-cli` → `pegana-replay`** (name available; `cargo install pegana-replay`; crates.io page matches the grant wording exactly). The `[[bin]]` is already `pegana-replay`.
2. **Deliver both halves of "open only pegana-replay":** the public source repo (`github.com/lrafasouza/pegana-replay`) **and** crates.io.
3. **Guides live in the public repo README + `docs/`** (canonical, next to the code). No new web pages.

---

## E1 — Publish `pegana-replay` (crates.io + public source repo)

**The chain (validated — exactly 3 crates, no `pegana-common`, no git deps):**
```
pegana-common-verify (0.1.0, leaf)  →  pegana-methodology (0.4.0)  →  pegana-replay (renamed from pegana-replay-cli, 0.4.1)
```
`pegana-common-verify` is the verifier-safe carve-out (no Redis/webhook/Sentry). The server-side `pegana-common` is NOT in the chain and is NOT published.

**Mechanics (confirmed against the official Cargo docs via context7):**
- Each internal path dep MUST gain a `version` for publish: `{ path = "../common-verify", version = "0.1.0" }` (keeps local builds working; lets crates.io resolve). Path-only deps are rejected by crates.io.
- Publish **in dependency order**: `pegana-common-verify` → `pegana-methodology` → `pegana-replay`.
- `cargo publish --dry-run` (and `cargo package --list`) on each, in order, BEFORE the real publish.
- **Irreversible:** crates.io has `cargo yank` (hide a version) but **no delete**, and names are permanent. Treat every publish as final → dry-run gate is mandatory.

**Public source repo (`github.com/lrafasouza/pegana-replay`):**
- Step 0: confirm whether the repo already exists/is current (the `repository` field + `releases.pegana.xyz` already point at it). If absent/stale, populate it from `tools/pegana-replay-public/` scaffold (Cargo.toml workspace manifest, LICENSE, METHODOLOGY.md, CONTRIBUTING.md, release.yml) + the 3 carved crates + `assets.toml` + `docs/adr/`.
- This repo is the source crates.io points to and the "open source" half of the deliverable. It must contain ONLY the 3 verifier crates + assets.toml + ADRs + docs — NEVER `docs/strategy/**`, `docs/operations/**`, `.superpowers/`, or `pegana-common`.

**Byte-exactness guarantee:** we publish the **real** `pegana-methodology` crate (version-pinned 0.4.0), so the published CLI reproduces the exact engine hash. No port, no drift. Baseline check: `pegana-replay --bundle docs/backtests/2025-10-10-usde-depeg/receipts/USDe-004.json` must still print `recomputed receipt:31c06db4fc9a matches`.

**Done when:** `cargo install pegana-replay` works from a clean machine and verifies a live alert; the public repo is browsable; methodology stays 0.4.0.

## E2 — "Verify in 60s" guide

The zero-install path (in-browser `receipt-verifier.tsx`) is already live; the CLI path is `cargo install pegana-replay` (or the installer) + `pegana-replay --alert-id <UUID>`. The guide makes the 60-second path explicit and canonical.

- **Home:** the public repo `README.md` "Verify in 60 seconds" section (install → run → read PASS/FAIL), plus a one-paragraph "no install? verify in your browser" pointer to the live in-browser verifier.
- Content: copy-paste `cargo install pegana-replay` + `pegana-replay --alert-id <UUID>` (and the `--bundle` form), the expected `PASS receipt_sha256 matches` output, and what PASS/FAIL means (tamper-evidence vs verdict re-derivation for v2 receipts).
- **No new web UI.** Link the existing in-browser verifier.

**Done when:** a skeptic with only the README can verify a real alert ID in ~60s by either path.

## E3 — Builder guide ("consume the peg feed")

A short on-ramp for a third party to consume `/v1/assets` — leveraging the existing `crates/api-rs/src/openapi.rs` (OpenAPI) and `docs/spec.html` (endpoint reference).

- **Home:** `docs/` markdown (e.g. `docs/guides/consume-the-peg-feed.md`) + linked from the public repo README.
- Content: keyless `GET /v1/assets` (filters `?peg=USD`, `?class=lst`), how to read the response (`state`, `anchor`, `risk_side`, `state_reason`, discount), poll cadence + rate limits, and how to go from an alert to a verifiable receipt (ties into E2). Mention the OpenAPI spec for full schema.
- Coverage statement: **63 assets** (LSTs, stables incl. FX BRZ/EURC, yield wrappers, CDPs, synth-leverage) — all reproducible.

**Done when:** a builder can poll the feed and interpret a verdict in a few minutes from the guide alone.

## Weekly community updates (grant requirement)

Five posts, ~1/week, each anchored to real shipped work (and doubling as demand top-of-funnel). Drafts produced as content, founder posts:
1. **Self-audit** — "We audited our own oracle (61 findings) and shipped the fixes" (closeout: `state_reason`, reliability, depth probe).
2. **Depth/real exit-liquidity** — "Why a 1-unit price quote lies" (ADR-0028 / sHYUSD class).
3. **Verify in 60s** — crates.io launch + the E2 guide ("trust nothing but a binary").
4. **Coverage + open methodology** — "63 pegged assets, one peg signal, byte-reproducible" + builder guide.
5. **sUSD/Hylo wedge** — the article the founder is already posting ("what a real depeg looks like").

## Risks & constraints
- **crates.io is permanent** → mandatory `--dry-run` + dependency-order publish; double-check metadata before each.
- **Keep methodology 0.4.0** → published CLI verifies existing receipts; do NOT bump as part of this work (B Phase 1 is separate + gated).
- **Public-repo hygiene** → never mirror business/ops content; only the 3 crates + assets.toml + ADRs + docs.
- **ADR-0007 freeze honored** → this is grant *delivery* of existing capability (publish + docs), NOT new features.

## Out of scope (deliberately cut — challenged)
- ❌ More FX assets (AUDD/MXNe/XSGD) — KPI (≥40) already met; adding assets = new feature (freeze) + doesn't change the KPI.
- ❌ New web `/verify` or `/build` pages — the in-browser verifier already exists; README/docs are the canonical home.
- ❌ Methodology 0.5.0 / B Phase 1 — separate, time-gated, founder-gated.
- ❌ Publishing `pegana-common` or any server-side crate.

## Success criteria (grant KPI)
- `pegana-replay` installable from crates.io (`cargo install pegana-replay`) + public source repo browsable.
- All tracked assets reproducible (in-browser or CLI); coverage ≥ 40 (have 63).
- ≥ 1 external consumer (tokens.xyz integration — in progress).
- Verify-60s guide + builder guide published.
- Weekly community updates posted through 2026-07-31.
