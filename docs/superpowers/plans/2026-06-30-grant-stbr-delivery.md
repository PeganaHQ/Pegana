# Grant STBR Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining grant deliverables — publish `pegana-replay` to crates.io, ship the "verify in 60s" + builder guides, and draft the weekly community updates — over already-built code (no new features).

**Architecture:** Publish the 3 verifier-safe crates (`pegana-common-verify` → `pegana-methodology` → `pegana-replay`) from the monorepo to crates.io (path deps gain a `version`; package `pegana-replay-cli` renamed to `pegana-replay`). The public source repo (`github.com/lrafasouza/pegana-replay`) already exists + the binary installer is live; we confirm it is current. Guides are Markdown in `tools/pegana-replay-public/README.md` (mirrors to the public repo) + `docs/`. Methodology stays 0.4.0 so existing receipts verify byte-exactly.

**Tech Stack:** Rust / `cargo publish`, crates.io, Markdown, existing `crates/api-rs/src/openapi.rs` + `docs/spec.html`.

> ⚠️ **crates.io is irreversible** (yank, no delete; names permanent). Tasks 4–6 are gated on the dry-run/package inspection in Task 3 AND explicit founder go. Do NOT run a real `cargo publish` without that.

---

## File structure (what changes)

- `crates/pegana-replay-cli/Cargo.toml` — rename package `name` to `pegana-replay`; add `version` to 2 path deps. (Directory name unchanged.)
- `crates/methodology/Cargo.toml` — add `version` to its 1 path dep.
- `.github/workflows/` + `release.yml` / cargo-dist config — update any `pegana-replay-cli` package references (if present).
- `tools/pegana-replay-public/README.md` — add/expand the "Verify in 60 seconds" section (mirrors to the public repo).
- `docs/guides/consume-the-peg-feed.md` — NEW builder guide.
- `docs/strategy/2026-06-30-grant-weekly-updates.md` — NEW weekly-post drafts.

---

## Task 1: Rename the published package to `pegana-replay`

**Files:**
- Modify: `crates/pegana-replay-cli/Cargo.toml:2`
- Check: any references to the package name `pegana-replay-cli`

- [ ] **Step 1: Find every reference to the package name (rename blast radius — VALIDATED 2026-06-30)**

Run:
```bash
cd <repo>
grep -rn "pegana-replay-cli" . | grep -vE "target/|node_modules/|\.git/|Cargo.lock"
```
The rename touches the PACKAGE NAME only. Confirmed hits that MUST change (Steps 2–3):
- `crates/pegana-replay-cli/Cargo.toml:2` — the `name` (Step 2).
- `Cargo.toml:115` — cargo-dist bin-alias `"pegana-replay-cli" = ["pegana-replay"]` (Step 3).
- `tools/pegana-replay-public/Cargo.toml:86` — same bin-alias in the public-repo workspace manifest (Step 3).
- `crates/xtask/tests/backtest_runner.rs:334` — `-p pegana-replay-cli` in a test invocation; MUST become `-p pegana-replay` or the backtest test breaks (Step 3).

Confirmed hits that MUST NOT change (they reference the **directory** `crates/pegana-replay-cli`, which is NOT renamed): root `Cargo.toml:11` workspace member path, `tools/pegana-replay-public/Cargo.toml:6`, the `web/app/**` GitHub source links (`.../tree/main/crates/pegana-replay-cli`), `ROADMAP.md`, `Cargo.lock` (regenerates on build). Prose comments (`Cargo.toml:88`) are cosmetic — optional.

- [ ] **Step 2: Rename the package name (NOT the directory, NOT the bin)**

In `crates/pegana-replay-cli/Cargo.toml`, change line 2:
```toml
# before
name        = "pegana-replay-cli"
# after
name        = "pegana-replay"
```
Leave the `[[bin]] name = "pegana-replay"` and the directory `crates/pegana-replay-cli/` unchanged.

- [ ] **Step 3: Update the 3 package-name references found in Step 1**

- `Cargo.toml:115` — change the cargo-dist bin-alias key: `"pegana-replay-cli" = ["pegana-replay"]` → `"pegana-replay" = ["pegana-replay"]`.
- `tools/pegana-replay-public/Cargo.toml:86` — same change.
- `crates/xtask/tests/backtest_runner.rs:334` — change `.args(["run", "-p", "pegana-replay-cli", "--", "--bundle", bundle])` → `"-p", "pegana-replay"`.

- [ ] **Step 4: Verify the workspace builds, the binary name is unchanged, and the backtest test still passes**

Run:
```bash
cargo build -p pegana-replay 2>&1 | tail -3
ls target/debug/pegana-replay && echo "bin OK"
cargo test -p xtask --test backtest_runner 2>&1 | tail -5
```
Expected: builds clean; `target/debug/pegana-replay` exists (binary name unchanged); the backtest_runner test passes with the new `-p pegana-replay`.

- [ ] **Step 5: Commit**

```bash
git add crates/pegana-replay-cli/Cargo.toml Cargo.toml tools/pegana-replay-public/Cargo.toml crates/xtask/tests/backtest_runner.rs
git commit -m "build(replay): rename published package pegana-replay-cli -> pegana-replay (crates.io KPI)"
```

## Task 2: Add `version` to internal path deps (crates.io requirement)

**Files:**
- Modify: `crates/methodology/Cargo.toml` (1 path dep)
- Modify: `crates/pegana-replay-cli/Cargo.toml` (2 path deps)

> Validated against the Cargo docs (context7): a path dependency must carry a `version` to be publishable; `path` is kept for local builds, `version` is used by crates.io.

- [ ] **Step 1: Add version to methodology's dep**

In `crates/methodology/Cargo.toml`:
```toml
# before
pegana-common-verify       = { path = "../common-verify" }
# after
pegana-common-verify       = { path = "../common-verify", version = "0.1.0" }
```

- [ ] **Step 2: Add versions to pegana-replay's deps**

In `crates/pegana-replay-cli/Cargo.toml`:
```toml
# before
pegana-methodology   = { path = "../methodology" }
pegana-common-verify = { path = "../common-verify" }
# after
pegana-methodology   = { path = "../methodology", version = "0.4.0" }
pegana-common-verify = { path = "../common-verify", version = "0.1.0" }
```

- [ ] **Step 3: Make the published `pegana-common-verify` crate self-contained (gate the external-file test)**

`crates/common-verify/src/lib.rs:459-461` has a test `assets_toml_parses` that does `include_str!("../../../assets.toml")` — a file OUTSIDE the crate. This does NOT block publish (it is `#[cfg(test)]`; `cargo publish` verifies with a build-only step, which excludes tests), but the *published* crate's test would fail to compile for a skeptic who downloads the crate source and runs `cargo test`. Gate it behind a `workspace-tests` feature so the published crate carries no external-file dependency.

In `crates/common-verify/Cargo.toml`, add a features section:
```toml
[features]
# Enables tests that read files from the workspace root (e.g. ../../../assets.toml).
# Off by default so the published crate on crates.io is self-contained.
workspace-tests = []
```
In `crates/common-verify/src/lib.rs`, add the cfg gate on the test fn (line 458):
```rust
    #[test]
    #[cfg(feature = "workspace-tests")]
    fn assets_toml_parses() {
```

- [ ] **Step 4: Verify — default build excludes the external-file test; workspace-tests includes it**

Run:
```bash
cargo build -p pegana-replay 2>&1 | tail -3
cargo test -p pegana-common-verify 2>&1 | grep -c "assets_toml_parses"    # expect 0 (gated out by default)
cargo test -p pegana-common-verify --features workspace-tests 2>&1 | grep "assets_toml_parses"  # expect it runs + passes
```
Expected: workspace builds clean; the test is absent by default and present+passing with `--features workspace-tests`.

- [ ] **Step 5: Commit**

```bash
git add crates/methodology/Cargo.toml crates/pegana-replay-cli/Cargo.toml crates/common-verify/Cargo.toml crates/common-verify/src/lib.rs
git commit -m "build(replay): version internal path deps + gate external-file test for a clean published crate"
```

## Task 3: Pre-flight — inspect exactly what will be uploaded (no network writes)

**Files:** none (inspection only)

- [ ] **Step 1: List the files each crate will upload**

Run, for each crate:
```bash
cargo package --list -p pegana-common-verify
cargo package --list -p pegana-methodology
cargo package --list -p pegana-replay
```
Expected: each lists ONLY that crate's own `src/`, `Cargo.toml`, and (if present) README/LICENSE. **Confirm NO `docs/strategy`, NO `docs/operations`, NO sibling crate, NO `.env`, NO secret appears in any list.** If anything unexpected appears, STOP and add it to that crate's `exclude` in Cargo.toml before continuing.

- [ ] **Step 2: Confirm each publishable crate has the required metadata**

Run:
```bash
for c in pegana-common-verify pegana-methodology pegana-replay; do
  echo "== $c =="; cargo metadata --no-deps --format-version 1 \
    | python3 -c "import sys,json;[print(' ',p['name'],p['version'],p.get('license'),'desc:'+('Y' if p.get('description') else 'N')) for p in json.load(sys.stdin)['packages'] if p['name']=='$c']"
done
```
Expected: each prints name, version (0.1.0 / 0.4.0 / 0.4.1), `MIT`, `desc:Y`.

- [ ] **Step 3: Gate — STOP here for founder go before any real publish.** crates.io is permanent. Do not proceed to Task 4 without explicit approval.

## Task 4: Publish `pegana-common-verify` (the leaf, first)

**Files:** none (crates.io action)

- [ ] **Step 1: Authenticate (one-time)**

Run (founder's crates.io token):
```bash
cargo login   # paste token from https://crates.io/settings/tokens
```

- [ ] **Step 2: Dry-run the leaf**

Run:
```bash
cargo publish -p pegana-common-verify --dry-run 2>&1 | tail -15
```
Expected: packages + builds clean, ends without error (the leaf has no internal deps).

- [ ] **Step 3: Publish**

Run:
```bash
cargo publish -p pegana-common-verify
```
Expected: `Uploading pegana-common-verify v0.1.0`. Wait ~30–60s for index propagation before the next task.

## Task 5: Publish `pegana-methodology` (depends on common-verify)

**Files:** none (crates.io action)

- [ ] **Step 1: Dry-run (now that common-verify is on crates.io)**

Run:
```bash
cargo publish -p pegana-methodology --dry-run 2>&1 | tail -15
```
Expected: resolves `pegana-common-verify = 0.1.0` from crates.io, builds clean. If it errors with "no matching package named pegana-common-verify", wait ~60s for index propagation and retry.

- [ ] **Step 2: Publish**

Run:
```bash
cargo publish -p pegana-methodology
```
Expected: `Uploading pegana-methodology v0.4.0`. Wait ~30–60s.

## Task 6: Publish `pegana-replay` (the CLI, last)

**Files:** none (crates.io action)

- [ ] **Step 1: Dry-run**

Run:
```bash
cargo publish -p pegana-replay --dry-run 2>&1 | tail -15
```
Expected: resolves `pegana-methodology = 0.4.0` + `pegana-common-verify = 0.1.0` from crates.io, builds the `pegana-replay` binary clean.

- [ ] **Step 2: Publish**

Run:
```bash
cargo publish -p pegana-replay
```
Expected: `Uploading pegana-replay v0.4.1`.

## Task 7: Verify the published CLI installs + reproduces the canonical hash

**Files:** none (verification)

- [ ] **Step 1: Install from crates.io into a clean location**

Run:
```bash
cargo install pegana-replay --root /tmp/pegana-verify-test --locked 2>&1 | tail -5
/tmp/pegana-verify-test/bin/pegana-replay --help | head -3
```
Expected: installs; `--help` prints. (KPI: `cargo install pegana-replay` works.)

- [ ] **Step 2: Byte-exact baseline — reproduce the known receipt hash**

Run:
```bash
/tmp/pegana-verify-test/bin/pegana-replay --bundle docs/backtests/2025-10-10-usde-depeg/receipts/USDe-004.json 2>&1 | grep -iE "recomputed|PASS"
```
Expected: `PASS ... recomputed receipt:31c06db4fc9a matches stored receipt:31c06db4fc9a`. This proves the published crate reproduces the engine hash (methodology 0.4.0 preserved).

- [ ] **Step 3: Clean up the test install**

Run:
```bash
rm -rf /tmp/pegana-verify-test
```

## Task 8: Confirm the public source repo is current

**Files:** the separate `github.com/lrafasouza/pegana-replay` repo (clone to a scratch dir)

- [ ] **Step 1: Clone + inspect the public repo**

Run:
```bash
git clone https://github.com/lrafasouza/pegana-replay /tmp/pegana-replay-pub 2>&1 | tail -2
ls /tmp/pegana-replay-pub/crates 2>/dev/null
grep -m1 '^name' /tmp/pegana-replay-pub/crates/pegana-replay-cli/Cargo.toml 2>/dev/null || echo "check crate dirs"
```
Expected: contains `crates/{common-verify,methodology,pegana-replay-cli}` + `assets.toml` + `docs/adr/`.

- [ ] **Step 2: Diff the carved crates vs the monorepo (must match the published source)**

Run:
```bash
for c in common-verify methodology pegana-replay-cli; do
  echo "== $c =="; diff -rq crates/$c/src /tmp/pegana-replay-pub/crates/$c/src 2>&1 | head
done
diff -q assets.toml /tmp/pegana-replay-pub/assets.toml
```
**CONFIRMED STALE (2026-06-30):** the public repo exists and has `crates/{common-verify,methodology,pegana-replay-cli}`, but still uses the OLD package name `pegana-replay-cli` and pre-rename Cargo.tomls. So the sync is REQUIRED (not conditional): mirror the 3 crates + `assets.toml` + `docs/adr/` from the monorepo carrying the Task 1+2 edits (package rename → `pegana-replay`, path+version deps, the `workspace-tests` feature gate), keep the public workspace manifest (`tools/pegana-replay-public/Cargo.toml` — note its member dir stays `crates/pegana-replay-cli`), commit + push the public repo. NEVER copy `docs/strategy/**`, `docs/operations/**`, `.superpowers/`, or `pegana-common`.

- [ ] **Step 3: Clean up**

```bash
rm -rf /tmp/pegana-replay-pub
```

## Task 9: "Verify in 60 seconds" guide

**Files:**
- Modify: `tools/pegana-replay-public/README.md` (mirrors to the public repo)

- [ ] **Step 1: Add/expand the "Verify in 60 seconds" section**

In `tools/pegana-replay-public/README.md`, add a section after the intro:
```markdown
## Verify a Pegana alert in 60 seconds

**Option A — install the CLI (crates.io):**
```sh
cargo install pegana-replay
pegana-replay --alert-id <UUID>     # an alert id from pegana.xyz or the API
# → PASS  receipt_sha256 matches   (tamper-evidence: the published history wasn't altered)
```
Or verify a saved bundle offline: `pegana-replay --bundle <path-to-replay-bundle.json>`.

**Option B — no install, verify in your browser:**
Open the audit page for any alert — `https://www.pegana.xyz/audit/<alert-id>` — where the in-browser
verifier (`ReceiptVerifier`) recomputes the canonical receipt hash in pure JS (byte-identical to the
CLI), trusting nothing from our servers.

**What PASS means:** the `receipt_sha256` you recomputed equals the published one → the verdict and its
inputs were not altered after the fact. For schema-v2 receipts the CLI also re-derives the verdict from
the frozen inputs (not just the hash).
```

- [ ] **Step 2: Verify the commands in the guide actually work**

Run:
```bash
grep -A2 "cargo install pegana-replay" tools/pegana-replay-public/README.md
```
Expected: the snippet matches the real package name `pegana-replay` (from Task 1).

- [ ] **Step 3: Commit**

```bash
git add tools/pegana-replay-public/README.md
git commit -m "docs(replay): add 'verify in 60s' quickstart (CLI + in-browser) — grant M2c"
```

## Task 10: Builder guide — consume the peg feed

**Files:**
- Create: `docs/guides/consume-the-peg-feed.md`

- [ ] **Step 1: Write the builder guide**

Create `docs/guides/consume-the-peg-feed.md`:
```markdown
# Consume the Pegana peg feed

Pegana publishes a keyless, public peg-risk feed over REST. This guide gets you from zero to
interpreting a verdict in a few minutes. Full schema: the OpenAPI spec (`/openapi.json`) and
`docs/spec.html`.

## 1. List all tracked assets
```sh
curl -s https://api.pegana.xyz/v1/assets            # all 63 assets
curl -s "https://api.pegana.xyz/v1/assets?peg=USD"  # filter by peg target
curl -s "https://api.pegana.xyz/v1/assets?class=lst" # filter by class
```

## 2. Read the verdict (per asset)
| Field | Meaning |
|---|---|
| `state` | `PEGGED` / `DRIFT` / `DEPEG` / `CRITICAL` / `UNKNOWN` |
| `anchor` | what the peg is measured against: `USD` / `FX` / `NAV` |
| `risk_side` | `below` / `above` / `either` — which direction the risk is |
| `state_reason` | present on overrides (e.g. `premium_sanity`, `stale_source`) |
| `discount` | signed market-vs-intrinsic spread |

## 3. Poll cadence + limits
Poll `/v1/assets` no faster than once every few seconds; the feed updates on state transitions.
Rate limits apply per IP (see headers). For push instead of poll, use webhooks (`/account/webhooks`).

## 4. From an alert to a verifiable receipt
Every state transition ships a content-addressed receipt. Verify it with the CLI
(`cargo install pegana-replay; pegana-replay --alert-id <UUID>`) or in your browser — see
the "Verify in 60 seconds" guide.

## Coverage
63 assets today: LSTs, stablecoins (incl. FX: BRZ→BRL, EURC→EUR), yield wrappers, CDPs,
synthetic-leverage tokens — all reproducible.
```

- [ ] **Step 2: Verify the documented endpoints are real**

Run:
```bash
curl -s -o /dev/null -w "v1/assets: %{http_code}\n" "https://api.pegana.xyz/v1/assets"
curl -s -o /dev/null -w "v1/assets?peg=USD: %{http_code}\n" "https://api.pegana.xyz/v1/assets?peg=USD"
```
Expected: both `200`. Confirm `anchor`/`state`/`risk_side` appear in the response body.

- [ ] **Step 3: Commit**

```bash
git add docs/guides/consume-the-peg-feed.md
git commit -m "docs(guides): builder guide — consume the peg feed — grant M3"
```

## Task 11: Weekly community-update drafts

**Files:**
- Create: `docs/strategy/2026-06-30-grant-weekly-updates.md`

- [ ] **Step 1: Write the 5 post drafts**

Create `docs/strategy/2026-06-30-grant-weekly-updates.md` with 5 ready-to-post drafts (founder posts ~1/week through 2026-07-31), each anchored to real shipped work:
1. **Self-audit** — "We audited our own oracle (61 findings) and shipped the fixes" (closeout: `state_reason`, reliability, depth probe). Angle: transparency.
2. **Real exit-liquidity** — "Why a 1-unit price quote lies" (ADR-0028 / sHYUSD class).
3. **Verify in 60s** — crates.io launch + the M2c guide ("trust nothing but a binary").
4. **Coverage + open methodology** — "63 pegged assets, one peg signal, byte-reproducible" + builder guide.
5. **sUSD/Hylo wedge** — the article the founder is posting ("what a real depeg looks like").

Each draft: a hook, 2–3 sentences of substance, one concrete artifact/link (alert id, crates.io page, guide, article), one CTA. Keep them in the founder's voice.

- [ ] **Step 2: Commit**

```bash
git add docs/strategy/2026-06-30-grant-weekly-updates.md
git commit -m "docs(strategy): 5 weekly grant-update drafts (build-in-public)"
```

---

## Self-Review

**1. Spec coverage:**
- E1 crates.io publish → Tasks 1–7. E1 public repo → Task 8. E2 verify-60s → Task 9. E3 builder guide → Task 10. Weekly updates → Task 11. ✅ All spec sections covered.
- Locked decisions: rename → Task 1; both halves (repo+crates.io) → Tasks 4–6 + 8; guides in README/docs → Tasks 9–10. ✅
- Out-of-scope (more FX, new web pages, 0.5.0) → not present in any task. ✅

**2. Placeholder scan:** no TBD/TODO; every code/doc step shows the exact content. Task 1 Step 3 is conditional on Step 1's grep output (legitimate — the rename targets are discovered), not a placeholder.

**3. Type/name consistency:** package name `pegana-replay` used consistently from Task 1 onward; versions (common-verify 0.1.0, methodology 0.4.0, pegana-replay 0.4.1) consistent across Tasks 2–7; binary name `pegana-replay` unchanged throughout.

**Ordering note:** Tasks 4–6 MUST run in order (dependency publish order) and are gated by Task 3 Step 3 (founder go) due to crates.io irreversibility.

**CI note (from the feature-gate in Task 2 Step 3):** after gating `assets_toml_parses` behind `workspace-tests`, the monorepo's default `cargo test --workspace` no longer runs it. To retain that regression coverage, the monorepo test/CI command for that crate should pass `--features workspace-tests` (e.g. `cargo test -p pegana-common-verify --features workspace-tests`). The published crate stays clean either way.

## 1:1 pre-flight validation (2026-06-30 — done before any execution)

Every risky assumption was checked live; the plan above was corrected to match reality:
- ✅ crate names all AVAILABLE on crates.io; 3-crate chain confirmed (no `pegana-common`, no git deps); metadata (MIT/description/version) complete on all 3.
- ✅ publish mechanics confirmed against official Cargo docs (context7): path+version dual-spec, publish-in-dependency-order, `--dry-run`, yank-not-delete.
- ✅ byte-exact baseline reproduces `31c06db4fc9a` from the local build (Task 7 will re-confirm from the crates.io install).
- ✅ API filters live: `/v1/assets`→63, `?peg=USD`→23, `?class=lst`→38, `?peg=EUR`→1 (EURC); OpenAPI at `/openapi.json`→200.
- ✅ in-browser verifier location = `/audit/[id]` (`web/app/(marketing)/audit/[id]/page.tsx` mounts `ReceiptVerifier`); guide wording corrected (Task 9).
- ⚠️ FIXED IN PLAN: rename blast radius (xtask backtest test + 2 cargo-dist bin-aliases — Task 1); external-file test in common-verify (feature-gated — Task 2); public repo confirmed STALE, sync required (Task 8).
- **Not a blocker:** the `include_str!` external-file reference is `#[cfg(test)]` only; `cargo publish` (build-only verify) is unaffected.
