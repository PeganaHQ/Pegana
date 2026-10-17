# IDL Cache (D6)

This directory holds **hardcoded IDLs** for on-chain programs Pegana decodes.
A cron task in `indexer-rs` periodically calls `anchor idl fetch` and compares
against the checked-in IDL — if the hash differs, Sentry alert fires and the
asset is degraded to `state=UNKNOWN` until a human updates the IDL and ships
new bindings.

## Programs tracked

| Program | Address | Source |
|---|---|---|
| Hylo Exchange | `HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn` | `anchor idl fetch HYEXCH...` |
| Hylo Stability Pool | `HysTabVUfmQBFcmzu1ctRd1Y1fxd66RBpboy1bmtDSQQ` | `anchor idl fetch HysTab...` |

## How to refresh

```bash
# Requires anchor-cli installed and SOLANA_RPC_URL set.
anchor idl fetch HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn \
    > idls/hylo_exchange.json
anchor idl fetch HysTabVUfmQBFcmzu1ctRd1Y1fxd66RBpboy1bmtDSQQ \
    > idls/hylo_stability_pool.json

# Then commit and re-run divergence check:
cargo xtask verify-idls
```

## IDL files

(populate via the commands above — empty placeholders until first fetch)
