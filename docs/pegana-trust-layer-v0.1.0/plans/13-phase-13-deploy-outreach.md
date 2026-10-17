> ⚠️ **AMENDED** — see [`../AMENDMENTS.md`](../AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original plan preserved below as historical reference.

---

# Phase 13 — Production Deploy + Outreach

**Spec reference**: `../02-architecture.md § Deploy topology`, `../01-business-rules.md § 6. Outreach posture`
**Acceptance criteria covered**: AC85 (asset activation), AC89-AC92 (outreach)
**Dependencies**: ALL previous phases (1-12), Phase 0.5 calibration verdict = "ship", Phase 0.4 webhook dogfood OK
**Calendar gate**: 2026-06-11 (no earlier)
**Estimated duration**: 1 day deploy + outreach over 1 week

---

## Task 13.1 — Pre-deploy checks (gate)

**Files**: none (operational verification only)

- [ ] **Step 1**: All tests green

```bash
cargo test --workspace
cd mcp-ts && bun test && cd -
cd bot-ts && bun test && cd -
cd web && bun typecheck && cd -
```

Expected: every line PASSes. If any fail, STOP. Deploy slips.

- [ ] **Step 2**: Calibration v1 verdict = "ship"

Re-read `docs/CALIBRATION-v1.md`. Confirm:
- Per-asset p50/p95/p99 filled for all 21 active + 5 Phase 0 assets
- Launch verdict explicitly written as "SHIP"
- If "TUNE" or "EXTEND": STOP, deploy slips per Phase 0.5

- [ ] **Step 3**: Webhook dogfood report shows delivery rate ≥ 99%

Re-read `docs/operations/webhook-dogfood-2026-06-03.md`. Confirm metrics meet targets.

- [ ] **Step 4**: Engine wallet funded ≥ 0.5 SOL

```bash
# Verify wallet balance on mainnet
solana balance <PEGANA_COMMIT_WALLET_PUBKEY> --url mainnet-beta
```

Expected: ≥ 0.5 SOL. If lower, refund before deploy.

- [ ] **Step 5**: Migration dry-run on staging

Apply migrations 0028-0031 to staging Postgres:

```bash
DATABASE_URL=$STAGING_DATABASE_URL sqlx migrate run --source migrations
psql $STAGING_DATABASE_URL -c "\d alert_evidence"
psql $STAGING_DATABASE_URL -c "\d alert_events"
psql $STAGING_DATABASE_URL -c "SELECT * FROM methodology_versions;"
```

Expected: all 4 schema objects present + 0.1.0 active row.

- [ ] **Step 6**: Build Docker image with PEGANA_GIT_SHA

```bash
GIT_SHA=$(git rev-parse HEAD)
docker compose -f docker-compose.yml build \
    --build-arg PEGANA_GIT_SHA="$GIT_SHA" \
    engine api dispatcher
```

Expected: image builds; binary has SHA baked in.

- [ ] **Step 7**: Sigstore attestation on test release

Tag a release candidate, push, wait for cargo-dist CI to complete, verify attestation:

```bash
git tag rc-trust-layer-v0.1.0
git push origin rc-trust-layer-v0.1.0

# After CI completes (5-10min):
gh release download rc-trust-layer-v0.1.0 -p pegana-replay-x86_64-linux*
gh attestation verify pegana-replay-x86_64-linux \
    --owner lrafasouza --repo pegana
```

Expected: attestation verified.

---

## Task 13.2 — Production deploy + activate Phase 0 assets

**Files**: none (operational)

- [ ] **Step 1**: SSH to Hetzner, git pull

```bash
ssh ${PEGANA_DEPLOY_SERVER}
cd /opt/pegana
git fetch && git checkout main && git pull
```

- [ ] **Step 2**: Apply migrations

```bash
docker compose run --rm api sqlx migrate run --source /app/migrations
```

Expected: migrations 0028-0031 applied (some may be no-ops if Phase 0.1 already applied 0029).

- [ ] **Step 3**: Flip Phase 0 assets to active=true

Edit `assets.toml` on production checkout (or via PR):

For each of JupUSD, JLP, EURC, dzSOL, vSOL — change:
```toml
active = false
```
to:
```toml
active = true
```

Commit + push.

```bash
git add assets.toml
git commit -m "$(cat <<'EOF'
feat(assets): activate 5 Phase 0 assets — Trust Layer launch

JupUSD, JLP, EURC, dzSOL, vSOL flipped to active=true after 14-day
passive calibration. Per Phase 0.5 verdict "SHIP".

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push
```

Pull on prod: `cd /opt/pegana && git pull`.

- [ ] **Step 4**: Insert methodology version seed (if not already present)

```bash
docker compose exec postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB" \
    -c "SELECT version, status FROM methodology_versions;"
```

If 0.1.0 not present (migration 0030 should have inserted, but verify):

```sql
INSERT INTO methodology_versions VALUES ('0.1.0', 'methodology-v0.1.0', NOW(), 'active', NULL, NULL, 'Initial release');
```

- [ ] **Step 5**: Set PEGANA_COMMIT_KEYPAIR env

```bash
# On Hetzner, place keypair file at /opt/pegana/.secrets/commit-keypair.json (chmod 600)
# Edit .env:
echo "PEGANA_COMMIT_KEYPAIR=/opt/pegana/.secrets/commit-keypair.json" >> .env
echo "AUDIT_BASE_URL=https://pegana.xyz" >> .env
```

- [ ] **Step 6**: Flip FEATURE_PUBLIC_ALERTS=true

```bash
# In .env:
sed -i 's/FEATURE_PUBLIC_ALERTS=false/FEATURE_PUBLIC_ALERTS=true/' .env
```

- [ ] **Step 7**: Roll services

```bash
docker compose up -d --build engine api dispatcher mcp-ts bot
```

Expected: containers come up healthy. Run `docker compose ps`.

- [ ] **Step 8**: Smoke audit URL on real alert

Wait for next alert to be emitted naturally (or trigger via threshold change in staging twin first).

```bash
curl https://api.pegana.xyz/v1/audit/<that-alert-uuid> | jq
```

Expected: full receipt JSON returned.

Then verify the binary install:

```bash
curl --proto '=https' --tlsv1.2 -LsSf \
    https://releases.pegana.xyz/pegana-replay-installer.sh | sh
~/.pegana/bin/pegana-replay --alert-id <that-alert-uuid>
```

Expected: `✓ PASS` line printed.

- [ ] **Step 9**: Tag the methodology release

```bash
cd /local/checkout
git tag methodology-v0.1.0
git push origin methodology-v0.1.0
```

cargo-dist CI fires, builds 4-platform binaries, publishes to GitHub Releases with Sigstore attestations. `releases.pegana.xyz` reflects automatically.

- [ ] **Step 10**: Update CALIBRATION-v1.md with deploy timestamp

In `docs/CALIBRATION-v1.md`, add at top:

```markdown
**DEPLOYED**: 2026-06-11 HH:MM UTC. Trust Layer v0.1.0 live with 26 active assets.
```

Commit + push.

---

## Task 13.3 — Outreach Parity (Colosseum)

**Files**: Create `docs/outreach/parity-2026-06-11.md` (template + sent log)

- [ ] **Step 1**: Compose email

Subject: "State oracle for Parity prediction market settlement (Solana, verifiable, free integration)"

Body template:

```
Hi [Parity team],

We're Pegana — peg-risk oracle for Solana DeFi. We monitor 26 active assets
(stablecoins, LSTs, yield-bearing wrappers, CDPs) and emit verifiable
state-transition alerts (PEGGED → DRIFT → DEPEG → CRITICAL → BLACK_SWAN).

Just shipped Trust Layer v0.1.0 — every alert has:
- Public receipt page (/audit/[id]) with cryptographic hash
- On-chain commit via Solana SPL Memo (anchored to mainnet)
- Offline replay CLI (pegana-replay --alert-id <UUID>)
- Open-source methodology (crates.io: pegana-methodology v0.1.0)

For Parity prediction market settlement, you need a trustworthy state oracle
saying "this asset depegged". We're literally that — and our infrastructure is
designed for exactly this consumption pattern.

Integration options:
- Direct REST (free): GET /v1/audit/:id returns full receipt
- Webhook (HMAC ed25519 signed): receive every alert with evidence_url
- MCP tool subscribe_peg_events: paid $0.0005/call via x402 USDC on Solana
- TypeScript SDK on npm: @pegana/sdk-ts

Happy to do a 30-min walkthrough. We're solo-founder, Solana-native, mainnet-only.

Pegana on web: https://pegana.xyz
Recent audits: https://pegana.xyz/audit
Methodology: https://pegana.xyz/methodology

— Rafael
```

- [ ] **Step 2**: Send email; archive sent copy

```bash
mkdir -p docs/outreach
cat > docs/outreach/parity-2026-06-11.md <<'EOF'
# Parity (Colosseum) outreach

**Sent**: 2026-06-11 HH:MM
**To**: [contact email]
**Status**: awaiting response

[Email body archived]
EOF

git add docs/outreach/
git commit -m "docs(outreach): Parity (Colosseum) integration pitch sent"
```

---

## Task 13.4 — Outreach StableGuard

**Files**: Create `docs/outreach/stableguard-2026-06-11.md`

- [ ] **Step 1**: Compose email

Same template as Task 13.3 but tailored:

Subject: "Verifiable trigger for StableGuard insurance payouts (Solana coverage now live)"

Key adaptation: "For insurance payout triggers, you need an alert that's defensible in dispute. Our on-chain receipt anchor + offline replay CLI mean any payout disagreement can be verified by both parties independently."

- [ ] **Step 2**: Send + archive

```bash
cat > docs/outreach/stableguard-2026-06-11.md <<'EOF'
[Email body]
EOF
git commit -m "docs(outreach): StableGuard integration pitch sent"
```

---

## Task 13.5 — PR sendaifun/solana-new

**Files**: PR on external repo

- [ ] **Step 1**: Fork `sendaifun/solana-new` repo

- [ ] **Step 2**: Add Pegana entry

Locate the concepts/categories list. Add:

```markdown
### Peg-Risk Oracle for Agent Allocators

**Pegana** — verifiable peg-risk oracle for Solana DeFi.

**MCP endpoint**: `https://mcp.pegana.xyz`

**Tools**:
- `subscribe_peg_events(symbols, since_ts, threshold_bps?)` — paid via x402 USDC
- `verify_alert(alert_id)` — free, returns full audit receipt
- `get_assets`, `get_asset_state`, `get_methodology` — free

**Why agents care**: every alert returns `evidence_url` (public audit page),
`receipt_sha256` (canonical hash), and is anchored on-chain via Solana SPL
Memo. Agents can cite trustworthy state when explaining decisions.

**Coverage**: 26 active assets (stablecoins, LSTs, yield-bearing, CDPs).

**Source**: https://github.com/lrafasouza/pegana
**Methodology**: https://pegana.xyz/methodology
```

- [ ] **Step 3**: Submit PR

```bash
gh pr create --title "Add Pegana to peg-risk oracle concepts" \
    --body "Verifiable risk oracle for Solana — MCP endpoint with on-chain attestations."
```

- [ ] **Step 4**: Archive in repo

```bash
echo "PR URL: <pr-url>" >> docs/outreach/sendai-pr.md
git add docs/outreach/sendai-pr.md
git commit -m "docs(outreach): sendaifun/solana-new PR submitted"
```

---

## Task 13.6 — Twitter / Farcaster demo post

**Files**: none in repo (operational)

- [ ] **Step 1**: Record demo video per `docs/marketing/launch-demo-script.md` (Phase 12 Task 12.5)

Tools: QuickTime / OBS / Screen Studio. Target 60 seconds.

- [ ] **Step 2**: Post

Tweet copy (from script):

> Every Pegana alert is verifiable offline + on-chain.
>
> Methodology in open source. Replay CLI in one curl. SDK on npm + PyPI.
> The risk oracle Solana DeFi deserves.
>
> 26 assets monitored. 5 new launched today: JupUSD, JLP, EURC, dzSOL, vSOL.
>
> pegana.xyz/methodology

Attach: 60s video.

Tag: @JupiterExchange @KaminoFinance @DriftProtocol @Helius_Labs @TritonOne for reach.

- [ ] **Step 3**: Archive post URLs

```bash
echo "Twitter: <url>" >> docs/outreach/launch-posts.md
echo "Farcaster: <url>" >> docs/outreach/launch-posts.md
git add docs/outreach/launch-posts.md
git commit -m "docs(outreach): launch posts archived"
```

---

## Acceptance verification for Phase 13

- [ ] AC85 — 5 Phase 0 assets active=true in `assets.toml`; engine restarted
- [ ] AC65 — Engine wallet ≥ 0.5 SOL at deploy
- [ ] AC89 — Parity outreach email sent + archived
- [ ] AC90 — StableGuard outreach email sent + archived
- [ ] AC91 — PR submitted to sendaifun/solana-new
- [ ] AC92 — Twitter/Farcaster demo post published with screen recording

---

## Rollback procedure (if deploy goes wrong)

1. **Revert engine to previous Docker image**:
   ```bash
   docker compose down engine
   docker tag pegana-engine:previous pegana-engine:latest
   docker compose up -d engine
   ```

2. **Revert assets.toml** to keep new assets inactive:
   ```bash
   git revert <activation-commit>
   git push
   ```

3. **Roll back migrations** (LAST RESORT — append-only triggers complicate this):
   ```sql
   DROP TABLE alert_evidence CASCADE;
   DROP TABLE methodology_versions CASCADE;
   -- alert_events view + onchain_tx_sig column can stay (no harm)
   ```

4. **Disable FEATURE_PUBLIC_ALERTS** if dispatcher misbehaves:
   ```bash
   sed -i 's/FEATURE_PUBLIC_ALERTS=true/FEATURE_PUBLIC_ALERTS=false/' .env
   docker compose restart dispatcher
   ```

---

## Cross-references

- For acceptance criteria, see `../12-acceptance-criteria.md`.
- For Phase 14 (backtest publication, runs AFTER this phase), see `14-phase-14-15-post-launch.md`.
- For business rules on deploy gate, see `../01-business-rules.md § 5. Deploy gate`.
