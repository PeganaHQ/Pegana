# ADR-0041 — Reframe the public on-chain claim to an honest capability (lead with off-chain re-derivation)

- **Status:** Accepted (2026-07-19). On `landing/v2-port`, **NOT deployed**.
- **Scope:** public-facing copy that describes on-chain anchoring — the `releases` page, the
  `(marketing)` about / agents / whats-new pages, and the `/audit/[id]` OG description.
- **Does NOT change** the receipt page's per-receipt rendering (it already degrades honestly) or
  the off-chain re-derivation claims (always true).

## Context

Pegana's trust primitive is **off-chain byte-exact re-derivation**: `pegana-replay --alert-id
<UUID>` re-hashes the receipt and re-derives the verdict on the caller's machine — this **always**
works and is the real "verifiable, not vouched" claim (exit 0).

**On-chain anchoring** is a second, narrower layer. The engine writes a **Solana SPL Memo
commitment** (`crates/engine-rs/src/onchain_commit.rs`, `spl_memo::build_memo`, `MEMO_FORMAT =
"pegana-v1"`, payload `pegana-v1|version|alert_id|receipt_sha256`, signed by the commit wallet so
the tx log pins the signer — validated against Solana's SPL Memo docs + a **proven mainnet tx**
`3qrRYGaY…`, 2026-07-05). It is **cost-gated to severe transitions** (Depeg / Critical / Black
Swan) and requires `PEGANA_COMMIT_KEYPAIR` to be set.

**The problem:** prod currently has `PEGANA_COMMIT_KEYPAIR` **unset**. So a severe alert gets
`commit_status = not_applicable`, and the CLI correctly returns **`ONCHAIN_INCOMPLETE` (exit 5),
not PASS** for it (`state_expects_anchor` → a `not_applicable` on a severe state must not pass
silently). Yet several marketing surfaces asserted on-chain anchoring as **active / "(default)" /
"on-chain anchors for the events that matter" / "every signal … on-chain"**. A buyer who followed
our own copy and verified a *severe* alert (the ones that matter most) would get **exit 5** — a
launch-day contradiction on a product whose entire pitch is trust.

## Decision

**Reframe** the public copy so it is **true regardless of wallet state**, rather than gate the
launch on funding:

1. **Lead with the always-true off-chain re-derivation** (byte-exact, on your machine).
2. **Describe on-chain anchoring as OPTIONAL / a capability for severe transitions** — "when a
   receipt carries an on-chain anchor, the CLI also cross-checks it" — matching the `/audit/[id]`
   receipt page, which already shows "not anchored · cost-gated" when `commit_status =
   not_applicable`.

**Funding the commit wallet is an independent upgrade, not a prerequisite for honesty.** When the
founder funds it, severe alerts start anchoring and the (already-honest) copy still holds — it
never over-claimed, so it never needs to change back.

## Alternatives considered

- **(b) Fund the wallet + keep the "by default" copy.** Rejected as the *sole* fix: it's
  founder-only (spends real SOL), the wallet drains over time, and even fully funded the "default"
  wording is still wrong for Pegged/Drift/Unknown alerts, which are **cost-exempt and never
  anchored by design** — so the copy would keep over-claiming for the majority of alerts. Funding
  is welcome as an *upgrade*; it is not what makes the messaging honest.

## Consequences

- The verify command's public promise now matches reality on **every** alert state (severe or
  not, wallet funded or not).
- The copy is **stable across the funding decision** — no re-edit needed either way.
- Slightly softer marketing punch, traded for accuracy. Correct for a trust product: the strongest
  honest claim (off-chain byte-exact re-derivation, provable by anyone) is now the headline.

## Surfaces changed (2026-07-19)

`web/app/releases/page.tsx` (verify snippet + prose), `web/app/(marketing)/about/page.tsx` (FACTS
bullet), `web/app/(marketing)/audit/[id]/page.tsx` (OG description), `web/app/(marketing)/whats-
new/whats-new-client.tsx` (stat label), `web/app/(marketing)/agents/page.tsx` (prose). The
`about` page's "**Some** receipts are anchored on Solana" line was already honest and kept.
