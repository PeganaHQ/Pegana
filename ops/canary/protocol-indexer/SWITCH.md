# Switching the live protocol-indexer to the HF fix (only after a clean canary)

Precondition: canary-watch.sh shows >= 20 min of: running, oomkilled=false, no exit,
memory far below 1 GiB, `[kamino_hf] wrote N rows` and `[jupiter_lend_hf] wrote N rows`,
no 401, `loop_hf_distribution` freshest_ts advancing. Then:

1. `bash canary-down.sh </dev/null`            # free memory + keep ~/pegana clean
2. The branch fix/protocol-indexer-hf-crash must be merged to main and pushed by the
   orchestrator (deploy.sh deploys main; it requires a clean tree in ~/pegana).
3. Edit ~/pegana/.env (keeps SOLANA_RPC_URL as is):
       cp ~/pegana/.env ~/pegana/.env.bak.$(date +%s)
       # set HELIUS_API_KEY to the same 36-char key that is inside SOLANA_RPC_URL:
       KEY=$(sed -n 's/^SOLANA_RPC_URL=.*api-key=\([^&[:space:]]*\).*/\1/p' ~/pegana/.env | head -1)
       [ ${#KEY} -eq 36 ] || { echo bad key; exit 1; }
       sed -i "s|^HELIUS_API_KEY=.*|HELIUS_API_KEY=$KEY|" ~/pegana/.env   # add the line if absent
       grep -c '^HELIUS_API_KEY=' ~/pegana/.env                           # expect 1 (never cat the value)
   (.env is not tracked, so ~/pegana stays clean.)
4. `cd ~/pegana && ./scripts/deploy.sh --services 'protocol-indexer' </dev/null`
   (compose default KAMINO_HF_POLL_MS is now 3600000 via the merged compose change.)
5. Verify for 20 min: `docker inspect pegana-protocol-indexer --format '{{.State.Status}} {{.RestartCount}} {{.State.OOMKilled}} {{.State.Health.Status}}'`,
   `docker logs --tail 100 pegana-protocol-indexer`, loop_hf_distribution freshness,
   `docker stats --no-stream pegana-protocol-indexer`.

## Rollback
    cd ~/pegana
    cp ~/pegana/.env.bak.<timestamp> ~/pegana/.env      # restores the previous (invalid) HELIUS_API_KEY -> stable, HF frozen
    git checkout <previous-main-sha>                    # or deploy.sh from the prior release per your usual rollback
    ./scripts/deploy.sh --services 'protocol-indexer' </dev/null
Fastest safe stop-gap without redeploy: set HELIUS_API_KEY empty in .env and
`docker compose up -d --force-recreate protocol-indexer` (HF sources self-disable when the key is unset).
