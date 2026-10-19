# 🚀 MERGE RUNBOOK — `landing/v2-port` → prod (methodology 0.5.0 → 0.7.0)

**Status:** READY. Founder-executed. Validated 1:1 against the branch on 2026-07-18.
**Prod today:** engine binary = methodology **0.5.0** (built 2026-07-01; verified via the
on-chain anchor memo `pegana-v1|0.5.0|…`). On-chain commit **already LIVE** (do NOT re-enable).
**Branch:** methodology **0.7.0**, `pegana-replay` **0.5.0**, **346 commits ahead / 0 behind**
origin/main (clean superset — a PR merge is a fast-forward, no conflicts).

> ⚠️ This is a **VERDICT-AFFECTING** deploy. The Pyth confidence-gate (ADR-0032) is a
> **compile-time constant** (`PYTH_CONFIDENCE_GATE_BPS = 500`) — it goes live and can
> move published verdicts to UNKNOWN the instant the engine is recreated. Run **Step 2**
> (calibration) BEFORE Step 5 (recreate). The intrinsic-liveness gate (ADR-0038) is
> env-gated (safe, stays off).

---

## What this deploy activates (why it's the #1 action)

Prod runs 0.5.0 — it is missing the ENTIRE hardening arc. The merge ships, in one deploy:
- **ADR-0039** NAV-sanity ↔ BLACK_SWAN fix (a real >30% collapse no longer masked UNKNOWN forever)
- Pyth confidence-gate (ADR-0032) · intrinsic-liveness gate (ADR-0038, disabled-default)
- transition-FSM between-band fix · F-12 `checked_div` sweep · 2nd SSRF client fix
- indexer numéraire-staleness gate + DexScreener min-liquidity floor
- authoritative thresholds threaded through the whole UI + embed `reconcileBps` unification
- the `pegana.onchain` drain-alert group · market-cap (mig 0065) · LST coverage (mig 0064)
- eHYUSD relabel · source_task_up drop-guard · docs accuracy

---

## Ordered steps

### Step 0 · Pre-flight (verify state — do not skip)
```bash
# On your machine, in the repo:
git checkout landing/v2-port && git pull
git rev-list --count origin/main..HEAD   # expect ~346
git rev-list --count HEAD..origin/main   # MUST be 0 (clean FF). If >0, rebase first.
git status --porcelain                   # MUST be empty for deploy.sh (it aborts on a dirty tree)
cargo test --workspace && cargo clippy --workspace --all-targets && cargo fmt --all --check
cargo run -p xtask -- backtest --case 2025-10-10-usde-depeg --check   # golden byte-exact
cd web && bun run typecheck && bun run test && cd ..
```
✅ Gate: all green (last verified 2026-07-18: rust 568 · web 788 · clippy 0 · golden ✓).

### Step 1 · Publish crates FIRST (CLI-before-engine, ADR-0030)
The public CLI must re-derive the new 0.7.0 receipts, so it ships BEFORE the engine emits them.
```bash
# ⚠️ FIRST: rotate the leaked crates.io token (see memory: leaked token revoked).
#    cargo login <fresh-token>
# Publish methodology first (pegana-replay depends on it):
cargo publish -p pegana-methodology           # 0.6.1 → 0.7.0
# wait for it to index (~1-2 min), then:
cargo publish -p pegana-replay                # 0.4.4 → 0.5.0
# Verify the byte-exact install path buyers use:
cargo install pegana-replay --version 0.5.0 --force
```
> Note the 3-way version skew today: prod engine = 0.5.0, crates.io = 0.6.1/0.4.4, branch = 0.7.0/0.5.0.
> This deploy makes prod + crates.io both 0.7.0/0.5.0, ending the skew.

### Step 2 · Pyth confidence-gate calibration (BEFORE the recreate — verdict safety)
The 500bps gate is a compile-time const that goes live at recreate. Prove it is near-inert on
the live universe first (ADR-0032). Run against **prod** DB:
```bash
ssh ${PEGANA_DEPLOY_SERVER} 'cd ~/pegana && docker compose exec -T postgres \
  psql -U $POSTGRES_USER $POSTGRES_DB' <<'SQL'
-- Query B — GO/NO-GO inertness at 500bps (last 90d)
SELECT feed,
  count(*) FILTER (WHERE (confidence / NULLIF(price,0)) * 10000 > 500) AS trips_at_500bps,
  count(*) AS n,
  round(100.0 * count(*) FILTER (WHERE (confidence / NULLIF(price,0)) * 10000 > 500) / count(*), 4) AS pct
FROM oracle_snapshots
WHERE publish_time > now() - interval '90 days' AND price <> 0 AND confidence IS NOT NULL
GROUP BY feed ORDER BY trips_at_500bps DESC;
SQL
```
- **GO** if `trips_at_500bps` is ~0 on every healthy feed (or the only trips coincide with a
  documented incident, e.g. the 2026-06-24 JLP `JLP/USD.RR` garbage print).
- **NO-GO / recalibrate** if a healthy feed trips non-trivially → run Query A (p999 per feed,
  in ADR-0032 §Calibration) and raise `PYTH_CONFIDENCE_GATE_BPS` above every healthy feed's
  p999 before merging. This is the ONE verdict-safety gate that can't be undone after recreate.

### Step 3 · Merge the branch → origin/main (PR, NOT a local merge)
Local `main` is diverged (you FF-merge externally); the **feature branch** vs origin/main is
clean. Update origin/main via a **GitHub PR** (never a direct `git push origin main`):
```bash
git push origin landing/v2-port          # push the branch (safe — feature branch, Vercel PREVIEW only)
gh pr create --base main --head landing/v2-port \
  --title "Relaunch: methodology 0.7.0 + full hardening + on-chain-proven trust layer" \
  --body "See docs/MERGE-RUNBOOK-v0.7.0.md and docs/AUDIT-COMPLETE-2026-07-18.md"
# review, then:
gh pr merge --merge      # updates origin/main → triggers Vercel PROD web build (auto-promote)
```
> Vercel: the web auto-builds + auto-promotes on push to main (confirmed working 2026-06-20).
> Do NOT use `vercel --prod` CLI upload (broken for this repo — >10MB; loses the methodology
> CHANGELOG the build reads). Git-integration only.

### Step 4 · Deploy the backend (FULL deploy — build + migrate + recreate)
**Must be a FULL deploy, not `--config-only`.** `assets.toml` changed +151 lines (LST coverage,
market-cap) and the methodology changed — the running binary must be the one that understands the
new config. `--config-only` would reload the new assets.toml under the OLD 0.5.0 binary → mismatch.
```bash
# From an up-to-date `main` checkout (after the PR merged):
git checkout main && git pull --ff-only
./scripts/deploy.sh --migrate            # full: build w/ GIT_SHA baked (--no-cache) + migrate + force-recreate all
```
This single command (deploy.sh, already validated) does, on the server:
1. `git pull --ff-only` (pulls the merged origin/main) + `chmod +x scripts/*.sh`
2. **Applies migrations 0064–0068** via psql (idempotent — already-applied error harmlessly):
   `0064_lst_coverage_expansion` · `0065_asset_circulating_supply` · `0066_methodology_v0_7_0`
   · `0067_oracle_snapshots_feed_idx` · `0068_intrinsic_liveness`
3. `docker compose build --no-cache --build-arg PEGANA_GIT_SHA=<sha>` (SHA baked into receipts)
4. **`docker compose up -d --force-recreate api engine dispatcher indexer bot mcp-ts`**
   (`restart` does NOT reload env_file — force-recreate is mandatory)
   - ⚠️ **This is the moment** the Pyth gate + new assets.toml + 0.7.0 verdicts go live.
   - ⚠️ Confirm no self-calibration window is running (never recreate the engine mid-calibration).
5. prune build cache · 20s healthcheck · external smoke (`api.pegana.xyz/healthz`, `mcp.pegana.xyz/health`).

> **Drain alert:** the new `pegana.onchain` group ships in `ops/alerts/pegana.yml`. Prometheus
> loads rules from that file; recreate/reload prometheus so the group activates:
> `ssh deploy@… 'cd ~/pegana && docker compose up -d --force-recreate prometheus'`
> (or `curl -X POST localhost:9090/-/reload`). Verify: `promtool check rules ops/alerts/pegana.yml`.

### Step 5 · Post-deploy verification (prove it's healthy)
```bash
ssh ${PEGANA_DEPLOY_SERVER} 'cd ~/pegana
  echo "== engine on 0.7.0? =="; docker compose logs --since 3m engine | grep -iE "version|on-chain commit enabled"
  echo "== no false-UNKNOWN storm? =="; docker compose logs --since 3m engine | grep -ic "UNKNOWN"
  echo "== on-chain still enabled (pubkey 7Ppoyum…)? =="; docker compose logs --since 3m engine | grep -i "pubkey"
  echo "== services healthy =="; docker compose ps --format "table {{.Service}}\t{{.State}}\t{{.Status}}"'
# External:
curl -s https://api.pegana.xyz/v1/assets | python3 -c "import json,sys; d=json.load(sys.stdin); print('assets:', len(d.get('assets',d))); print('has market_cap:', any(a.get('market_cap') for a in (d.get('assets',d) if isinstance(d.get('assets',d),list) else [])))"
# Verify a fresh 0.7.0 receipt re-derives byte-exact with the published CLI:
cargo run -p pegana-replay -- --url https://api.pegana.xyz/audit?id=<recent_alert_id>   # expect PASS + on-chain anchor check
```
✅ GO if: engine logs 0.7.0 + "on-chain commit enabled" pubkey 7Ppoyum…; no UNKNOWN storm
(a few is fine — new gates are conservative; a WAVE across healthy assets = the Pyth gate is
mis-calibrated → roll back + widen the const); `/v1/assets` serves market_cap; a fresh receipt
verifies PASS.

### Step 6 · Rollback (if Step 5 fails)
```bash
# Backend: redeploy the previous good SHA (main~1 before the merge commit).
ssh ${PEGANA_DEPLOY_SERVER} 'cd ~/pegana && git reset --hard <prev_good_sha> && chmod +x scripts/*.sh'
./scripts/deploy.sh                       # rebuild + recreate at the old SHA
# Migrations are additive (new tables/columns) — they do NOT need reverting; the 0.5.0 binary ignores them.
# Web: Vercel → promote the previous deployment. On-chain: unaffected (already live, independent).
```
See `docs/runbooks/rollback.md` (real rollback = `scripts/pg-restore.sh` for data; this is the code path).

---

## Founder-only checklist (the whole thing is your call)
- [ ] Rotate the crates.io token, then Step 1 publish.
- [ ] Run Step 2 Query B; confirm the Pyth gate is inert (or recalibrate the const).
- [ ] Merge the PR (Step 3) → Vercel auto-deploys the web.
- [ ] Run `./scripts/deploy.sh --migrate` (Step 4) + recreate prometheus for the drain alert.
- [ ] Step 5 verification; GO/NO-GO.
- [ ] (Optional, post-merge) enable the intrinsic-liveness gate (ADR-0038) after its own calibration.
- [ ] GTM (separate track): un-hide /pricing only after its copy matches reality; send the Ernani reply.

## Non-obvious gotchas (all validated 1:1)
1. `deploy.sh` aborts on a dirty tree AND prompts if not on `main` — run it from a clean `main` checkout.
2. `--no-cache` build is intentional (bakes the GIT_SHA into receipts) — adds ~3 min.
3. `restart` never reloads env_file — force-recreate is the only way (deploy.sh already does this).
4. Migrations use bare `CREATE TABLE` (not IF NOT EXISTS) — re-applied ones error harmlessly (`set +e` in deploy.sh).
5. On-chain is ALREADY live — no keypair step. The wallet (0.0499 SOL) is fine; the drain alert just needs prometheus reload.
6. Receipt-version skew: 0.5.0 receipts already anchored on-chain stay verifiable with a 0.5.0-era CLI; new 0.7.0 receipts need the 0.5.0 CLI (methodology 0.7.0). Both coexist — the CLI keys off each receipt's `methodology_version`.
