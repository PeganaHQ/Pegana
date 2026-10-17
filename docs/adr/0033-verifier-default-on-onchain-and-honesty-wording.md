# ADR-0033 — Verifier default-on on-chain check + honesty rewrite

- **Status:** Accepted (2026-07-16). Implemented on `landing/v2-port`.
- **Amends:** `docs/pegana-trust-layer-v0.1.0/10-distribution.md` §8 (CLI
  surface + exit-codes table — superseded by this ADR).
- **Cross-refs:** ADR-0004 (on-chain commit retry/burst/alarm/UI policy —
  source of the `pending` / `not_applicable` / `retry_exhausted` /
  `wallet_drained` `commit_status` enum), ADR-0019 ("missing data ≠
  confirming data" invariant — this ADR extends it to "incomplete data ≠
  failing data").
- **Note:** ADR-0032 is reserved for a separate, parallel change (Pyth
  confidence gate) and is not this ADR.

## Context (the finding — "verify-oversells-tamper", HIGH)

`pegana-replay --alert-id <id>` is Trust Layer's flagship verifier command.
By default it only recomputed the receipt's canonical SHA-256
(`crates/pegana-replay-cli/src/main.rs`, `verify()`) and compared it to the
hash the API returned. The on-chain anchor + pinned-signer check
(`verify_onchain()`) only ran when the caller explicitly passed
`--verify-onchain`.

That hash-only check proves the receipt's fields are **internally
self-consistent** with the hash the server returned. It does **not** prove
the server didn't serve a **different, equally self-consistent** receipt —
an attacker (or a compromised API) could swap the whole receipt for a
plausible fabrication and the hash check alone would still pass, because
the hash is computed *from* the receipt it's checking, not against an
external source of truth. The on-chain SPL Memo anchor, signed by a
compile-time-pinned Pegana ops wallet, is the only check that closes this:
Solana's runtime only lands a transaction whose declared signer accounts
produced a valid ed25519 signature over it, so only the holder of the ops
wallet's key can produce a matching anchor.

Despite this, every public-facing description of the verifier — the CLI's
own module doc comment, the `Cargo.toml` package description, the public
README (`tools/pegana-replay-public/README.md`), the releases-page copy
(`web/app/releases/page.tsx`), the methodology page, the audit-detail page
metadata, and the in-browser verifier's own doc comment
(`web/lib/verify-receipt.ts`) — described "tamper-evidence" /
"verifies the on-chain anchor" as if that's what the default (or, for the
browser widget, the *only*) code path always does. It wasn't. A user who
ran the documented "60-second verify" command and saw `PASS` had, by
default, checked strictly less than what every surface told them they'd
checked.

## Decision

### 1. Flip the default: on-chain verification runs BY DEFAULT for `--alert-id`

- `pegana-replay --alert-id <id>` now performs **both** checks by default:
  (1) the hash self-consistency check (unchanged), and (2) the on-chain SPL
  Memo anchor + pinned-signer check (previously opt-in).
- New `--offline` flag (alias `--no-onchain`) is the escape hatch: hash-only,
  no RPC call, no network dependency beyond fetching the bundle itself. For
  CI, air-gapped hosts, or anyone who deliberately wants the fast check.
- `--bundle <path>` mode is **always** offline — a local file carries no
  `alert_id` to look an on-chain anchor up with. This was already true; it
  is now stated explicitly instead of left implicit.
- `--verify-onchain` is kept as a **hidden, back-compat no-op** (prints a
  deprecation note, does nothing else) so existing scripts that pass it
  don't break. It is not advertised in `--help`.
- `Cli`'s `long_about` (surfaced by `--help`) now states the default and the
  escape hatch directly, so the CLI is honest about its own behavior even
  without reading source or docs.

### 2. New exit code 5 — `ONCHAIN_INCOMPLETE`

Making the on-chain check default-on means every casual, unattended, or
scripted invocation now depends on network reachability to both the Pegana
API and a Solana RPC. Two states must never be conflated with a real
tamper/mismatch finding (exit 4, `ONCHAIN_MISMATCH`):

1. **RPC or API unreachable** — a connection failure, timeout, or any other
   `Err` from `verify_onchain()` now propagates up to `run()`, which prints
   an explicit "NOT a mismatch" message and exits **5**, not 4 and not a
   silent pass.
2. **`commit_status: pending`** — ADR-0004 gives on-chain commits up to a
   24h retry window before they either land or exhaust retries. A
   just-fired alert whose anchor hasn't landed yet is a legitimate,
   transient state, not evidence of tampering. Previously, hitting this
   state under `--verify-onchain` (opt-in, power-user-only) surfaced as the
   same hard `ANCHOR NOT VERIFIED` / exit 4 as a genuine signer/memo
   mismatch. Now that this path is hit by **default**, that conflation is
   no longer acceptable: `pending` is carved out into its own `bail!` inside
   `verify_onchain()`'s 404 branch (new `is_onchain_pending()` helper),
   which `run()` converts to exit 5.

This extends ADR-0019's "missing data ≠ confirming data" invariant one step
further: **incomplete data ≠ failing data**. A verifier that can't complete
a check must say so distinctly from a verifier that completed the check and
found a problem — collapsing the two either produces false alarms (pending
anchors reading as tamper) or, worse, would tempt a future maintainer to
paper over RPC flakiness by defaulting to a silent PASS.

`not_applicable` (cost-gated alerts, e.g. DRIFT, that are never anchored)
continues to skip silently, unchanged. `retry_exhausted` and
`wallet_drained` — genuine, permanent anchoring failures — remain hard exit
4 `ONCHAIN_MISMATCH`, unchanged; only `pending` moved. (Open question,
noted for the founder: whether `wallet_drained` specifically — an *ops*
incident, not a tamper signal — should also soften to exit 5 now that this
path is default-on. Left as exit 4 for this change to keep the diff minimal
and because "we tried and gave up" still seems worth flagging harder than
"still trying".)

### 3. Honesty rewrite across every surface

Every place that described the hash-only check as if it were the full
tamper-evidence guarantee was rewritten to state precisely which layer(s)
ran and what each proves:

- `crates/pegana-replay-cli/src/main.rs` module doc + exit-code table
- `crates/pegana-replay-cli/Cargo.toml` package `description`
- `tools/pegana-replay-public/README.md` (intro, Option A, "What PASS
  means", the components table row, the end-to-end walkthrough)
- `web/lib/verify-receipt.ts` (`verifyReceipt()` doc comment — states
  explicitly that the in-browser widget is **permanently** hash-only, never
  makes an RPC call, and points at the CLI's default mode for the stronger
  guarantee)
- `web/components/organisms/receipt-verifier.tsx` (PASS/FAIL copy: "Hash
  matches. Self-consistent…" / "…the receipt returned by the API", instead
  of the ambiguous "Verified. …the committed receipt")
- `web/app/(marketing)/audit/[id]/page.tsx` (`generateMetadata` — drops the
  blanket "on-chain anchored" claim, which is false for the `not_applicable`
  majority of alerts)
- `web/app/(marketing)/methodology/page.tsx`, `web/app/releases/page.tsx`,
  `web/public/releases/pegana-replay-installer.sh` (verify snippets/prose
  updated to the new default + `--offline`)
- `web/app/backtest/2025-10-10-usde-depeg/static-receipt-verifier.tsx`
  (secondary finding — added an explicit "does not confirm the on-chain
  anchor" caveat; existing PASS-copy test regex is unaffected)

No receipt schema, hashing, or methodology logic changed. `pegana-methodology`
is untouched; every historical receipt still verifies byte-for-byte
identically. Only the CLI's default flag and every surface's wording
changed.

## Versioning

- **CLI:** `pegana-replay` `0.4.4` → `0.5.0`. 0.x semver; a default-behavior
  change that (a) adds a network dependency by default and (b) grows the
  exit-code surface by one is a breaking change for any script piping
  `--alert-id` without `--offline`.
- **Methodology:** unchanged (`0.6.1`). No migration.

## Consequences

- Positive: the flagship command's default behavior now matches every
  public claim made about it. The gap that let a compromised API defeat the
  advertised tamper-evidence guarantee (without `--verify-onchain`) is
  closed by default, not opt-in.
- Cost: default `--alert-id` now requires a reachable Solana RPC. Mitigated
  by `--offline` for CI/air-gapped use, and by exit 5 degrading gracefully
  (clear message, never a false PASS, never conflated with exit 4) when RPC
  is unreachable.
- Follow-up (not blocking this change): characterize how often
  `commit_status: pending` actually fires against prod (`alert_evidence`
  distribution + age-of-pending queries) to decide whether default-on
  `ONCHAIN_INCOMPLETE(pending)` is common enough to warrant a "try again in
  a minute" UX hint. Founder's call, not gating this ship.

## Cross-refs

- `crates/pegana-replay-cli/src/main.rs` (`Cli`, `run()`, `verify_onchain()`,
  `is_onchain_pending()`)
- `crates/pegana-replay-cli/tests/replay.rs` (new: `offline_flag_skips_onchain_network_call`,
  `pending_commit_status_gives_exit5_not_exit4`,
  `not_applicable_commit_status_silently_skips`,
  `retry_exhausted_status_is_still_hard_onchain_mismatch`,
  `deprecated_verify_onchain_flag_is_backward_compatible_noop`,
  `bundle_mode_notes_onchain_not_available`,
  `onchain_memo_mismatch_still_gives_exit4`)
- ADR-0004 (`commit_status` enum + 24h retry window)
- ADR-0019 (missing/incomplete data invariant)
- ADR-0028 (exact-match methodology version check — exit 3, unaffected)
