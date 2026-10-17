# SAS commit wallet — refund runbook

> Operator-facing. How to top up the on-chain commit (SAS) wallet that the
> engine uses to anchor critical-alert receipts on Solana mainnet.

## The wallet

| Field | Value |
|---|---|
| Pubkey | `7PpoyumFQMmcWzhJxDYr6iPv1fjYN41KBTA8xKKzu7R9` (Solflare) |
| Keypair file | `/opt/pegana/.secrets/commit-keypair.json` on Hetzner (`pegana-prod-01`, `<prod-host>`), `chmod 600` |
| Env wiring | `PEGANA_COMMIT_KEYPAIR=/opt/pegana/.secrets/commit-keypair.json` in `~/pegana/.env` |
| Cost per commit | ~0.0001 SOL (signature + SAS/Memo fee) |
| Refill threshold | **≥ 0.05 SOL** (covers ~500 commits ≈ 6 weeks at historical rates) |

The keypair stays on the box (path-only via env, never the secret itself). The
**signing** wallet only ever needs to *spend*; refunds are sent *to* the pubkey
from any wallet you control.

## When to refund

Refund **before** the balance reaches the floor. Two independent signals fire:

- **Engine gauge** `pegana_commit_wallet_balance_sol` → Grafana panel
  "Commit wallet balance (SOL)" alerts when it crosses below **0.05 SOL**.
  (The wallet decreases by ~0.0001 SOL per critical alert.)
- **Sentry** captures a `pegana commit wallet CRITICAL: 0.XXXX SOL` event.
  Since PR #45 this capture is **throttled to once per hour**, so a low balance
  no longer floods the Sentry quota — one event/hour, not one per tick. Treat a
  single CRITICAL as actionable, not noise.

Do **not** wait for commit failures: an empty wallet makes the engine emit
evidence rows with `onchain_tx_sig IS NULL`, which weakens the trust pitch.
Refilling is preventative, not reactive.

## Check the current balance

```bash
# From your laptop (no SSH needed — the pubkey is public)
curl -sS https://api.mainnet-beta.solana.com -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getBalance","params":["7PpoyumFQMmcWzhJxDYr6iPv1fjYN41KBTA8xKKzu7R9"]}' \
  | python3 -c "import sys,json;r=json.load(sys.stdin);print(f'{r[\"result\"][\"value\"]/1e9:.6f} SOL')"
```

Or just open Solscan: <https://solscan.io/account/7PpoyumFQMmcWzhJxDYr6iPv1fjYN41KBTA8xKKzu7R9>.

## Top up

Send SOL to the pubkey from any wallet (Solflare, Phantom, a CEX withdrawal —
all work; this is a plain SOL transfer, no special instruction).

```bash
# If you have the Solana CLI + a funded keypair locally:
solana transfer 7PpoyumFQMmcWzhJxDYr6iPv1fjYN41KBTA8xKKzu7R9 0.2 \
  --url mainnet-beta --allow-unfunded-recipient
```

A 0.2 SOL top-up buys ~4 months of headroom at historical alert rates. Round up;
SOL is cheap relative to the cost of a missing on-chain anchor at launch.

## Verify after refund

1. Re-run the balance check above — expect the new total.
2. The engine gauge updates on its next scrape; the Grafana panel clears within
   a few minutes and the hourly Sentry CRITICAL stops firing on the next window.
3. No engine restart is required — the gauge is read live, not at boot.

## If commits are *failing* (not just low balance)

A low balance and a *failing commit* are different. If `pegana_onchain_commit_total{outcome=...}`
shows `rpc_error`/`timeout` rather than `insufficient funds`, the wallet is fine —
that is a Solana RPC / network issue, not a refund problem. See
[`13-risks-and-mitigations.md` § R9](../pegana-trust-layer-v0.1.0/13-risks-and-mitigations.md)
and the launch runbook's Sentry triage table.

## Off-host backup (critical)

The R2 backup pipeline (`scripts/pg-backup.sh`) backs up **Postgres only**.
Two files live on the box's filesystem and are **NOT in any backup**:

1. **`/opt/pegana/.secrets/commit-keypair.json`** — the SPL Memo signing keypair.
   If lost: the on-chain tamper-evidence layer is permanently dead. No
   replacement wallet can forge the signature. The receipt chain in Postgres
   (backed up to R2) survives, but receipts can no longer be anchored on-chain.

2. **`~/.pegana-backup-key`** — the AES-256 encryption key for R2 backups.
   If lost: **all R2 backups become unrecoverable** (undecryptable). The entire
   backup pipeline is dead.

**Action:** copy both to at least one off-host location (laptop + offline).

```bash
# From your laptop, download both files from the VPS:
scp ${PEGANA_DEPLOY_SERVER}:/opt/pegana/.secrets/commit-keypair.json \
    ~/pegana-secrets-backup/
scp ${PEGANA_DEPLOY_SERVER}:~/.pegana-backup-key \
    ~/pegana-secrets-backup/

chmod 0600 ~/pegana-secrets-backup/*
# Store offline (USB, password manager, encrypted volume).
# Re-verify periodically that local copies match VPS originals.
```

> ⚠️ These files are excluded from git by `.gitignore` (`*keypair*.json`,
> `.secrets/`). They are also blocked by the cred-guard hook
> (`.claude/hooks/block-credentials.sh`). They will never be committed.

## Cross-refs

- [`launch-runbook-2026-06-11.md`](./launch-runbook-2026-06-11.md) § 1 (on-chain wallet pre-deploy check)
- [`13-risks-and-mitigations.md` § R9 / R11](../pegana-trust-layer-v0.1.0/13-risks-and-mitigations.md)
- ADR-0004 — on-chain commit retry/burst/alarm policy
- Memory: `reference_ops_wallet.md`
