# ADR-0018: MCP x402 ran on devnet in production — mainnet claim retraction

- **Status:** Accepted
- **Date:** 2026-05-30
- **Supersedes:** none
- **Amended by:** none
- **Related:** ADR-0004 (on-chain commit policy), ADR-0011 (mcp verify_alert free with telemetry)

## Context

A read-only SSH probe of the production Hetzner host (`<prod-host>`, HEAD `c59132a`,
all 11 containers Up/healthy) on 2026-05-30 showed the live `mcp-ts` container environment
resolving:

    SOLANA_NETWORK=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1   # DEVNET genesis hash
    X402_FACILITATOR_URL=https://x402.org/facilitator        # public, devnet-only facilitator
    CDP_API_KEY_ID=<present>
    CDP_API_KEY_SECRET=<present>

`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` is the devnet genesis hash; the mainnet-beta
hash is `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`. Every x402-paid MCP call in production
has therefore been settling in **devnet USDC (no market value)**. This contradicts the
public claim and the `project_x402_facilitator_block.md` memory asserting "MCP paid mainnet
LIVE … 7 on-chain settlements as of 2026-05-27." Two compounding defects:

1. **`SOLANA_NETWORK` resolves to devnet.** `docker-compose.yml:161` hardcoded the devnet
   genesis hash as the fallback default (`${SOLANA_NETWORK:-solana:EtWTRABZ…}`), so any
   environment lacking an explicit mainnet override silently runs devnet.
2. **`X402_FACILITATOR_URL` is the public `x402.org/facilitator` (devnet-only)**, not the
   Coinbase CDP facilitator the memory claimed was swapped in. CDP keys ARE present, yet the
   explicit facilitator URL + devnet network mean the intended mainnet settlement path was
   never the active one.

## Decision

1. **Settlement-network invariant.** Production `mcp-ts` MUST resolve
   `SOLANA_NETWORK=solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` (mainnet-beta) and MUST route
   x402 settlement through the Coinbase CDP facilitator
   (`https://api.cdp.coinbase.com/platform/v2/x402`). The public `x402.org/facilitator` is
   devnet-only and MUST NOT be the active facilitator in prod.

2. **Env fix + force-recreate (operator action).** In `~/pegana/.env` on the host, change ONLY:

       SOLANA_NETWORK=solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp

   CDP keys are already present, so the CDP facilitator is already active — **no
   `X402_FACILITATOR_URL` and no `CDP_WALLET_ID` change is needed** (see §Clarification). Then
   `docker compose up -d --force-recreate mcp-ts` (NOT `restart` — restart does not re-read
   env). Verify with `docker compose exec -T mcp-ts printenv SOLANA_NETWORK`.

3. **Remove the devnet footgun (repo).** `docker-compose.yml:161` fallback changed to the
   mainnet genesis hash; `mcp-ts/.env.example` example updated to mainnet. (Shipped in the
   2026-05-30 post-QA sweep.)

4. **Retract the mainnet claim until verified.** Pull "MCP paid mainnet LIVE / 7 on-chain
   settlements" from README/marketing/memory until the 7 settlement signatures are confirmed
   on Solscan mainnet. If they resolve only on devnet, reword GTM to "MCP paid tools wired;
   mainnet settlement pending verification." Re-date any "first mainnet settlement" milestone
   to the first real call issued AFTER the env fix (confirm `PEGANA_PAYTO_USDC` + CDP wallet
   funded/correct first, to avoid a second false claim).

5. **Verdict-gate scope.** This blocks the x402 "mainnet LIVE" GTM claim for the 2026-06-11
   verdict gate. It does NOT block the core Trust Layer (engine/API/web/bot), which are
   network-agnostic for the calibration verdict.

### Clarification (2026-05-30 — CORRECTED after reading `mcp-ts/src/x402.ts`)

An earlier draft of this ADR blamed an incomplete CDP key set / a missing `CDP_WALLET_ID`. **That was wrong.** Reading `mcp-ts/src/x402.ts:40-57`, the facilitator selection is unambiguous:

```
if (CDP_API_KEY_ID && CDP_API_KEY_SECRET) → CDP facilitator (mainnet-capable; X402_FACILITATOR_URL IGNORED)
else                                       → bare-URL facilitator (X402_FACILITATOR_URL ?? public x402.org, devnet-only)
```

- **CDP takes precedence.** mcp-ts reads ONLY `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET` (`createFacilitatorConfig(id, secret)`). It NEVER reads `CDP_WALLET_ID`, and it IGNORES `X402_FACILITATOR_URL` whenever the two CDP keys are present.
- **Prod already had both CDP keys set** (`CDP_API_KEY_ID` len 36, `CDP_API_KEY_SECRET` len 88) → the production facilitator was ALREADY the CDP facilitator (mainnet-capable). The recon agent's "facilitator = public x402.org" was a mis-inference from the (ignored) `X402_FACILITATOR_URL=x402.org` env var.
- **The ONLY real defect was `SOLANA_NETWORK=solana:EtWTRABZ…` (devnet).** The CDP facilitator settles on whichever network the server registers (`server.register(network)`, `network = SOLANA_NETWORK`), so CDP-facilitator + devnet-network = devnet settlements.
- **Fix applied + verified 2026-05-30:** edited `~/pegana/.env` line 63 `SOLANA_NETWORK` → `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` (mainnet-beta) only; `docker compose up -d --force-recreate mcp-ts`. Verified: container `SOLANA_NETWORK` = mainnet, status `Up (healthy)`, `mcp.pegana.xyz/health` = 200, `get_assets` responding. **No new secret, no `CDP_WALLET_ID`, no `X402_FACILITATOR_URL` change required.** `X402_FACILITATOR_URL=x402.org` was left in `.env` (inert under CDP precedence; harmless footgun only if the CDP keys are ever removed).

## Consequences

- **Positive:** settlement network becomes an explicit, verified invariant; the silent
  devnet default is eliminated; the GTM claim becomes truthful or is retracted.
- **Cost:** any "first mainnet settlement" milestone must be re-dated to the actual post-fix
  mainnet call; the prior "7 settlements" evidence is likely invalidated and must be
  regenerated on mainnet.
- **Risk:** a real mainnet paid call costs real USDC — confirm `PEGANA_PAYTO_USDC` and the
  CDP wallet are funded/correct before re-issuing the milestone call.

## Verification (settlements check plan)

The 7 cited settlements (memory commit `dc1b3c9`) must be checked:

1. Gather the 7 signatures from prod Postgres (read-only) or the `dc1b3c9` diff.
2. `https://solscan.io/tx/<sig>` (mainnet) vs `https://solscan.io/tx/<sig>?cluster=devnet`.
3. Or `getTransaction` RPC against `api.mainnet-beta.solana.com` and `api.devnet.solana.com`
   — whichever returns non-null is where it settled.
4. Given the live env is devnet, expect all 7 to resolve on devnet → retract the
   "7 mainnet settlements" claim; the first true mainnet settlement is the post-ADR-0018 call.

**Result (2026-05-30, RPC-verified):** signatures are NOT stored in the DB (`mcp_call_log` has no
tx column). Verified instead via the receiver's USDC token accounts. Receiver
`EAfKRjgLGWma3N4pE51ZMdbVpoWmSHALKgmHWKPodjnw`:

- **mainnet** USDC ATA `4N3AdZDSCWMjwLVQ6yL3agAXvm9oDkNg8s6yvsr8epMb` → **3 tx / 0.002 USDC** (early)
- **devnet** USDC ATA `HpajJc1FivkqQtHpo99wQCXGhYyVvwxAEntpLEdLkYBY` → **50+ tx / 0.082 USDC** (recent)

So the "mainnet LIVE" milestone was **real but only 3 mainnet settlements** (~2026-05-27). The
"**7 on-chain mainnet settlements**" claim is **corrected to "3 early mainnet settlements"**.

### C4 reconciliation (2026-05-30) — devnet was INTENTIONAL, not a regression

Commit `7da9158` (C4, 2026-05-27) shows the devnet state was **deliberate**: after proving the
mainnet path with the ~3 settlements (incl. tx `tibrTH1UetZ1fyRNMpb31bz5…`), prod was intentionally
reverted to devnet for ongoing dogfood, with the documented precondition *"the default stays devnet
until the receiver is rotated to a hardware-wallet-controlled address."* So the QA's "P0 regression"
framing was imprecise — the genuine defect was the **overstated "7 settlements / mainnet LIVE"
claim**, not the devnet network itself. The 50+ devnet settlements were intended dogfood, not breakage.

On **2026-05-30 the project owner confirmed** the current receiver
`EAfKRjgLGWma3N4pE51ZMdbVpoWmSHALKgmHWKPodjnw` IS the hardware-wallet-controlled address → the C4
precondition for mainnet-default is now met. Flipping `SOLANA_NETWORK` to mainnet therefore
**completes the C4 rotation (intended end-state)**, not reverts a regression. Mainnet-default is the
correct, owner-confirmed state going forward; dogfood paid calls now settle real mainnet USDC. **No
validation paid call was fired** — C4's tx `tibrTH…` already proves the mainnet settlement path.

### Update (2026-05-31) — post-deploy mainnet settlement CONFIRMED

After the 2026-05-31 hardening deploy (#70 / #76), a fresh validation paid call **was** fired
against prod (`ping_paid`, $0.001, via `mcp-ts/test/integration/c3-soak.ts` with
`C3_TOTAL_CALLS=1`). It settled **SUCCESS on mainnet-beta** — slot `423470667`, 2026-05-31
23:05 UTC, tx
[`4z6fHLxTnkeXq4xaE25XcSgfk3DYkNVE81Vvi8JqY6Ny8G35WCrBp5CYkwd6cLWSzCwKi6nCNcK7UgBNcTPiaTyv`](https://solscan.io/tx/4z6fHLxTnkeXq4xaE25XcSgfk3DYkNVE81Vvi8JqY6Ny8G35WCrBp5CYkwd6cLWSzCwKi6nCNcK7UgBNcTPiaTyv),
RPC-verified: **+0.001 USDC** to the receiver `EAfKRjgLGWma3N4pE51ZMdbVpoWmSHALKgmHWKPodjnw`,
SOL fee 0.000010 SOL. This is the first **post-fix** mainnet settlement and re-dates the
milestone to **2026-05-31** with current, independently-verifiable proof — the "x402 USDC
mainnet LIVE" claim no longer rests solely on the older C4 tx. (Diagnostic note: a SOL-only
payer fails with `InstructionError [2 InvalidAccountData]` — the payer's USDC ATA must be
funded first.)
