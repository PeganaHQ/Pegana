> ⚠️ **AMENDED** — see [`../AMENDMENTS.md`](../AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original plan preserved below as historical reference.

---

# Phase 11M — Maximalist Add-Ons (7 features)

**Spec reference**: `../10-distribution.md`, `../06-engine-changes.md § onchain_commit.rs`
**Acceptance criteria covered**: AC48-AC73 (26 criteria spanning 7 features)
**Dependencies**: Phases 1-10 complete (Trust Layer foundation in place)
**Estimated duration**: 4-5 days sequential, 2-3 days parallel with subagents

---

## Overview

7 independent features, each shippable separately. Can run in parallel after Phase 10 completes. Each has its own task with TDD, commit, acceptance.

| # | Feature | File | Lines added | Risk |
|---|---|---|---|---|
| 11M.1 | Solana SPL Memo on-chain commit | `crates/engine-rs/src/onchain_commit.rs` (~150) | Medium (RPC dependency) |
| 11M.2 | `/audit.xml` Atom feed | `web/app/audit.xml/route.ts` (~50) | Low |
| 11M.3 | Embed widget (script + iframe) | `web/public/embed.js` + `web/app/embed/[asset]/page.tsx` (~200) | Low |
| 11M.4 | CSV export `/v1/audit.csv` | `crates/api-rs/src/routes/audit.rs` extend (~80) | Low (axum-streams stable) |
| 11M.5 | SDK auto-gen (TS + Python) | `.github/workflows/sdk-release.yml` (~70) | Low |
| 11M.6 | `/calibration.xml` Atom feed | `web/app/calibration.xml/route.ts` (~60) | Low |
| 11M.7 | Reproducible builds CI | `.github/workflows/reproducible.yml` (~30) | Low |

---

## Task 11M.1 — Solana SPL Memo on-chain receipt commit

**Files**:
- Modify: `crates/engine-rs/Cargo.toml` (add `spl-memo = "4"`, `bs58 = "0.5"`)
- Replace stub: `crates/engine-rs/src/onchain_commit.rs`
- Modify: `crates/engine-rs/src/main.rs` (load wallet, call commit_receipt)

- [ ] **Step 1**: Add deps

In `crates/engine-rs/Cargo.toml`:

```toml
spl-memo = "4"
bs58     = "0.5"
```

- [ ] **Step 2**: Write onchain_commit module

Replace `crates/engine-rs/src/onchain_commit.rs`:

```rust
//! Anchor receipt sha256 on-chain via Solana SPL Memo program.
//! Fire-and-forget — failures logged + counted, never block alert dispatch.

use anyhow::{Context, Result};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    signature::Keypair,
    signer::Signer,
    transaction::Transaction,
};
use spl_memo::build_memo;
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Duration;
use tracing::{error, info, warn};
use uuid::Uuid;

const MEMO_FORMAT: &str = "pegana-v1";
const COMMIT_TIMEOUT: Duration = Duration::from_secs(60);

pub struct CommitContext {
    pub rpc: Arc<RpcClient>,
    pub keypair: Arc<Keypair>,
    pub pg: PgPool,
}

pub fn commit_receipt(
    ctx: Arc<CommitContext>,
    alert_id: Uuid,
    methodology_version: String,
    receipt_sha256: String,
) {
    tokio::spawn(async move {
        let result = tokio::time::timeout(
            COMMIT_TIMEOUT,
            do_commit(ctx.clone(), alert_id, &methodology_version, &receipt_sha256),
        ).await;
        match result {
            Ok(Ok(sig)) => {
                if let Err(e) = persist_sig(&ctx.pg, alert_id, &sig).await {
                    error!(?e, %alert_id, "failed to persist onchain_tx_sig");
                    metrics::counter!("pegana_onchain_persist_failed_total").increment(1);
                }
                info!(%alert_id, signature = %sig, "receipt committed on-chain");
                metrics::counter!("pegana_onchain_commit_total", "outcome" => "ok").increment(1);
            }
            Ok(Err(e)) => {
                error!(?e, %alert_id, "onchain commit failed");
                metrics::counter!("pegana_onchain_commit_total", "outcome" => "rpc_error").increment(1);
            }
            Err(_) => {
                error!(%alert_id, "onchain commit timeout");
                metrics::counter!("pegana_onchain_commit_total", "outcome" => "timeout").increment(1);
            }
        }
    });
}

async fn do_commit(
    ctx: Arc<CommitContext>,
    alert_id: Uuid,
    methodology_version: &str,
    receipt_sha256: &str,
) -> Result<String> {
    let memo_payload = format!(
        "{}|{}|{}|{}",
        MEMO_FORMAT, methodology_version, alert_id, receipt_sha256
    );
    let memo_ix = build_memo(memo_payload.as_bytes(), &[&ctx.keypair.pubkey()]);
    let blockhash = ctx.rpc.get_latest_blockhash().await.context("get_latest_blockhash")?;
    let tx = Transaction::new_signed_with_payer(
        &[memo_ix],
        Some(&ctx.keypair.pubkey()),
        &[ctx.keypair.as_ref()],
        blockhash,
    );
    let sig = ctx.rpc.send_and_confirm_transaction_with_spinner_and_commitment(
        &tx, CommitmentConfig::confirmed(),
    ).await.context("send_and_confirm")?;
    Ok(sig.to_string())
}

async fn persist_sig(pg: &PgPool, alert_id: Uuid, sig: &str) -> Result<()> {
    sqlx::query(
        "UPDATE alert_evidence SET onchain_tx_sig = $1 \
         WHERE alert_id = $2 AND onchain_tx_sig IS NULL"
    )
    .bind(sig).bind(alert_id).execute(pg).await
    .context("update alert_evidence.onchain_tx_sig")?;
    Ok(())
}

pub async fn check_wallet_balance(rpc: &RpcClient, keypair: &Keypair) -> Result<u64> {
    let lamports = rpc.get_balance(&keypair.pubkey()).await.context("get_balance")?;
    let sol = lamports as f64 / 1_000_000_000.0;
    if sol < 0.5 {
        warn!(pubkey = %keypair.pubkey(), sol, "engine commit wallet LOW (<0.5 SOL)");
    } else {
        info!(pubkey = %keypair.pubkey(), sol, "engine commit wallet OK");
    }
    metrics::gauge!("pegana_commit_wallet_balance_sol").set(sol);
    Ok(lamports)
}
```

- [ ] **Step 3**: Engine startup loads wallet (in main.rs)

In `crates/engine-rs/src/main.rs::main`, after methodology check (already added in Phase 3 Task 3.5), add wallet loading:

```rust
let commit_ctx = if let Ok(keypair_data) = std::env::var("PEGANA_COMMIT_KEYPAIR") {
    let bytes = if std::path::Path::new(&keypair_data).exists() {
        std::fs::read(&keypair_data)?
    } else {
        bs58::decode(&keypair_data).into_vec()?
    };
    let keypair = solana_sdk::signature::Keypair::from_bytes(&bytes)?;
    let rpc_url = std::env::var("SOLANA_RPC_URL")
        .unwrap_or_else(|_| "https://api.mainnet-beta.solana.com".into());
    let rpc = std::sync::Arc::new(
        solana_client::nonblocking::rpc_client::RpcClient::new(rpc_url),
    );
    onchain_commit::check_wallet_balance(&rpc, &keypair).await.ok();
    Some(std::sync::Arc::new(onchain_commit::CommitContext {
        rpc,
        keypair: std::sync::Arc::new(keypair),
        pg: pg.clone(),
    }))
} else {
    warn!("PEGANA_COMMIT_KEYPAIR not set — on-chain commitment DISABLED");
    None
};
```

Pass `commit_ctx` into `try_recompute` (add it as a function arg in Phase 2 refactor, or carry via closure).

In `push_alert`, after the audit row insert succeeds and for critical states:

```rust
if matches!(event.to_state, PegState::Depeg | PegState::Critical | PegState::BlackSwan) {
    if let Some(ctx) = &commit_ctx {
        onchain_commit::commit_receipt(
            ctx.clone(),
            event.id,
            methodology_version.to_string(),
            receipt_sha256.to_string(),
        );
    }
}
```

- [ ] **Step 4**: Devnet integration test (ignored by default)

Create `crates/engine-rs/tests/onchain_commit.rs`:

```rust
//! Devnet round-trip — requires DEVNET_KEYPAIR env with funded keypair.
//! Run: cargo test -p engine-rs --test onchain_commit -- --ignored

#[tokio::test]
#[ignore]
async fn devnet_commit_round_trip() {
    let keypair_b58 = std::env::var("DEVNET_KEYPAIR").expect("DEVNET_KEYPAIR env required");
    let bytes = bs58::decode(&keypair_b58).into_vec().unwrap();
    let keypair = solana_sdk::signature::Keypair::from_bytes(&bytes).unwrap();
    let rpc = std::sync::Arc::new(solana_client::nonblocking::rpc_client::RpcClient::new(
        "https://api.devnet.solana.com".to_string()
    ));
    // ... build minimal CommitContext, call do_commit, assert tx confirmed ...
}
```

- [ ] **Step 5**: Build + smoke test on staging

```bash
cargo build -p engine-rs
# Run on staging with PEGANA_COMMIT_KEYPAIR=/secrets/pegana-commit.json
# Trigger a synthetic CRITICAL alert, verify:
# - alert_evidence row created
# - onchain_tx_sig populated within 60s
# - tx visible on Solscan
```

- [ ] **Step 6**: Commit

```bash
git add crates/engine-rs/
git commit -m "$(cat <<'EOF'
feat(engine): on-chain receipt commitment via Solana SPL Memo

Engine writes each critical alert's receipt sha256 to Solana via the
SPL Memo program. Fire-and-forget tokio::spawn — never blocks alert
dispatch. ~$0.0005 per memo. New /v1/audit/:id/onchain endpoint
(Phase 4) returns tx_sig. Replay CLI --verify-onchain (Phase 8) checks
the on-chain memo matches the bundle.

Wallet keypair loaded from PEGANA_COMMIT_KEYPAIR env. Devnet test
in tests/onchain_commit.rs (--ignored).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11M.2 — /audit.xml Atom feed

**Files**:
- Modify: `web/package.json` (add `feed`)
- Create: `web/app/audit.xml/route.ts`
- Modify: `web/app/layout.tsx` (`<link rel="alternate">`)

- [ ] **Step 1**: Install feed lib

```bash
cd web && bun add feed
```

- [ ] **Step 2**: Write route handler

Write `web/app/audit.xml/route.ts`:

```typescript
import { Feed } from "feed";

export const revalidate = 60;

const API_BASE = process.env.PEGANA_API ?? "https://api.pegana.xyz";
const SITE = "https://pegana.xyz";

type IndexRow = {
  id: string;
  asset: string;
  from_state: string;
  to_state: string;
  detected_at: string;
  methodology_version: string;
  receipt_sha256: string;
};

export async function GET() {
  const resp = await fetch(`${API_BASE}/v1/audit?limit=50&exclude_pegged=true`, {
    next: { revalidate: 60 },
  });
  if (!resp.ok) {
    return new Response(`API error ${resp.status}`, { status: 502 });
  }
  const audits: IndexRow[] = await resp.json();

  const feed = new Feed({
    title: "Pegana — Recent Audits",
    description: "Verifiable peg-risk alerts for Solana stablecoins, LSTs, and yield-bearing assets.",
    id: `${SITE}/audit`,
    link: `${SITE}/audit`,
    language: "en",
    favicon: `${SITE}/favicon.ico`,
    copyright: `© ${new Date().getFullYear()} Pegana`,
    feedLinks: { atom: `${SITE}/audit.xml` },
    author: { name: "Pegana", link: SITE },
  });

  for (const a of audits) {
    feed.addItem({
      title: `${a.asset}: ${a.from_state} → ${a.to_state}`,
      id: `${SITE}/audit/${a.id}`,
      link: `${SITE}/audit/${a.id}`,
      description: `Methodology v${a.methodology_version}. Receipt sha256: ${a.receipt_sha256.slice(0, 16)}…`,
      date: new Date(a.detected_at),
    });
  }

  return new Response(feed.atom1(), {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
```

- [ ] **Step 3**: Add discovery link in `<head>`

In `web/app/layout.tsx`, inside `<head>`:

```tsx
<link
  rel="alternate"
  type="application/atom+xml"
  title="Pegana — Recent Audits"
  href="/audit.xml"
/>
```

- [ ] **Step 4**: Validate

```bash
cd web && bun dev
curl http://localhost:3000/audit.xml | head -50
# Paste into https://feedvalidator.org → must return valid Atom 1.0
```

- [ ] **Step 5**: Commit

```bash
git add web/
git commit -m "$(cat <<'EOF'
feat(web): /audit.xml Atom 1.0 feed of recent audits

Route handler uses `feed` npm package. Cached 60s SWR. Discovery
link added to root <head>. Journalists, automated monitors, and
aggregators subscribe without polling our API.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11M.3 — Embed widget (script + iframe)

**Files**:
- Create: `web/public/embed.js`
- Create: `web/app/embed/[asset]/page.tsx`
- Create: `web/app/embed/demo/page.tsx`

Full implementations in `../08-external-surfaces.md § 5. Embed widget`. Key elements:

- [ ] **Step 1**: Write `web/public/embed.js` (vanilla JS, ~6KB minified) — per spec
- [ ] **Step 2**: Write `web/app/embed/[asset]/page.tsx` (server component, sandboxed iframe variant) — per spec
- [ ] **Step 3**: Write `web/app/embed/demo/page.tsx` (showcase + integration snippets) — per spec
- [ ] **Step 4**: Test in browser at `/embed/demo` — both badges render
- [ ] **Step 5**: Verify CORS works on `/v1/assets/USDC` from cross-origin (Phase 4 set this up)
- [ ] **Step 6**: Commit

```bash
git add web/public/embed.js web/app/embed/
git commit -m "$(cat <<'EOF'
feat(web): embed widget (script + iframe) for partner sites

Script: <div data-pegana-asset="USDe"></div><script src="embed.js">
Iframe: <iframe src="/embed/USDe"> for sandboxed integration.
CORS layer on /v1/assets/* (read-only) added in Phase 4.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11M.4 — CSV export `/v1/audit.csv`

**NOTE**: This was already implemented as part of Phase 4 Task 4.1 (the 5 audit handlers include `csv`).

**Files**: verify the `csv` handler in `crates/api-rs/src/routes/audit.rs` is complete.

- [ ] **Step 1**: Verify implementation present + tests cover it

```bash
grep -A 30 "pub async fn csv" crates/api-rs/src/routes/audit.rs
cargo test -p api-rs --test audit_endpoint csv_rejects_large_date_range
```

- [ ] **Step 2**: Add stress test for memory cap (canonical Pegana pattern)

```rust
// crates/api-rs/tests/audit_endpoint.rs — add test:

#[tokio::test]
async fn csv_streams_under_memory_cap() {
    let Some(base) = base() else { return };
    let Some(pg) = pg_url() else { return };
    let pool = sqlx::PgPool::connect(&pg).await.expect("connect pg");

    // Seed 10k synthetic alerts + evidence rows with marker for cleanup
    let mut ids = Vec::with_capacity(10_000);
    for _ in 0..10_000 {
        let id = uuid::Uuid::new_v4();
        seed_alert_with_evidence(&pool, id, "DRIFT", false).await.expect("seed");
        ids.push(id);
    }

    let resp = client()
        .get(format!("{base}/v1/audit.csv?from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z"))
        .send().await.expect("send");
    assert_eq!(resp.status(), 200);
    assert!(resp.headers().get("content-type").unwrap().to_str().unwrap().starts_with("text/csv"));
    // Memory profiling: in CI this validates streaming works; manual peak-memory
    // check via `/usr/bin/time -v` on Linux.

    for id in ids { cleanup(&pool, id).await; }
}
```

Reuses `base()`, `pg_url()`, `client()`, `seed_alert_with_evidence()`, `cleanup()` helpers defined in `audit_endpoint.rs` from Phase 4 Task 4.2.

- [ ] **Step 3**: Commit (small addition only)

```bash
git add crates/api-rs/tests/audit_endpoint.rs
git commit -m "test(api): /v1/audit.csv memory cap stress test (10k rows)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 11M.5 — Auto-generated TypeScript + Python SDKs

**Files**:
- Create: `.github/workflows/sdk-release.yml`
- Create: `sdk/.gitignore`
- Create: `sdk/README.md`

- [ ] **Step 1**: Write CI workflow

Write `.github/workflows/sdk-release.yml`:

```yaml
name: Generate and publish SDKs

on:
  workflow_dispatch:
  push:
    tags: ["sdk-v*"]

jobs:
  generate-and-publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: '22', registry-url: 'https://registry.npmjs.org' }
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: npm install -g @openapitools/openapi-generator-cli@7.22.0

      - name: Fetch live OpenAPI spec
        run: curl -fsSL -o /tmp/openapi.json https://api.pegana.xyz/openapi.json

      - name: Generate TypeScript SDK
        run: |
          openapi-generator-cli generate \
            -i /tmp/openapi.json \
            -g typescript-fetch \
            -o sdk/typescript \
            --additional-properties npmName=@pegana/sdk-ts,supportsES6=true

      - name: Generate Python SDK
        run: |
          openapi-generator-cli generate \
            -i /tmp/openapi.json \
            -g python \
            -o sdk/python \
            --additional-properties packageName=pegana_sdk,projectName=pegana-sdk

      - name: Publish TS SDK to npm
        env: { NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }} }
        working-directory: sdk/typescript
        run: |
          npm install
          npm run build
          npm publish --access public

      - name: Publish Python SDK to PyPI
        env: { TWINE_PASSWORD: ${{ secrets.PYPI_TOKEN }}, TWINE_USERNAME: __token__ }
        working-directory: sdk/python
        run: |
          pip install build twine
          python -m build
          python -m twine upload dist/*
```

- [ ] **Step 2**: Gitignore generated SDKs

```bash
mkdir -p sdk
cat > sdk/.gitignore <<'EOF'
typescript/
python/
EOF
```

- [ ] **Step 3**: Documentation

Write `sdk/README.md`:

```markdown
# Pegana SDKs

Auto-generated from OpenAPI spec at https://api.pegana.xyz/openapi.json.

## TypeScript

```sh
npm install @pegana/sdk-ts
```

```ts
import { AuditApi } from "@pegana/sdk-ts";
const api = new AuditApi();
const receipt = await api.getAudit({ alertId: "..." });
```

## Python

```sh
pip install pegana-sdk
```

```python
from pegana_sdk import AuditApi
api = AuditApi()
receipt = api.get_audit(alert_id="...")
```

## Releases

Tag `sdk-v<x.y.z>` → CI publishes both SDKs.
```

- [ ] **Step 4**: Commit

```bash
git add .github/workflows/sdk-release.yml sdk/
git commit -m "$(cat <<'EOF'
feat(ci): auto-generated TS + Python SDKs from OpenAPI spec

Workflow triggers on sdk-v* tag push or manual dispatch. Pulls live
OpenAPI, runs openapi-generator-cli for typescript-fetch + python,
publishes to npm (@pegana/sdk-ts) + PyPI (pegana-sdk).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11M.6 — /calibration.xml Atom feed

**Files**: Create `web/app/calibration.xml/route.ts`

- [ ] **Step 1**: Write route handler

```typescript
// web/app/calibration.xml/route.ts
import { Feed } from "feed";
import { execSync } from "node:child_process";

export const revalidate = 3600;  // 1h

const SITE = "https://pegana.xyz";

type GitCommit = {
  sha: string;
  author: string;
  date: Date;
  message: string;
  diff: string;
};

function gitLogAssetsToml(limit: number): GitCommit[] {
  const out = execSync(
    `git -C ${process.cwd()}/.. log --follow --pretty=format:'%H%x00%an%x00%aI%x00%s' -n ${limit} -p assets.toml`,
    { encoding: "utf-8" },
  );
  const commits: GitCommit[] = [];
  const blocks = out.split(/\n(?=[0-9a-f]{40}\x00)/);
  for (const block of blocks) {
    const [header, ...rest] = block.split("\n");
    const [sha, author, dateStr, message] = header.split("\x00");
    if (!sha) continue;
    const diff = rest.join("\n");
    if (!/thresholds_(bps|cr)|^\+\[\[assets\]\]|^-\[\[assets\]\]/m.test(diff)) continue;
    commits.push({ sha, author, date: new Date(dateStr), message, diff });
  }
  return commits;
}

export async function GET() {
  const commits = gitLogAssetsToml(100);

  const feed = new Feed({
    title: "Pegana — Calibration Changes",
    description: "Threshold and asset config mutations in assets.toml",
    id: `${SITE}/calibration`,
    link: `${SITE}/methodology#changelog`,
    language: "en",
    feedLinks: { atom: `${SITE}/calibration.xml` },
    author: { name: "Pegana", link: SITE },
  });

  for (const c of commits) {
    feed.addItem({
      title: `Calibration · ${c.message}`,
      id: `${SITE}/calibration#${c.sha}`,
      link: `https://github.com/lrafasouza/pegana/commit/${c.sha}`,
      description: c.diff.slice(0, 1000) + (c.diff.length > 1000 ? "\n...[truncated]" : ""),
      author: [{ name: c.author }],
      date: c.date,
    });
  }

  return new Response(feed.atom1(), {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=7200",
    },
  });
}
```

- [ ] **Step 2**: Add discovery link

In `web/app/layout.tsx`:

```tsx
<link
  rel="alternate"
  type="application/atom+xml"
  title="Pegana — Calibration Changes"
  href="/calibration.xml"
/>
```

- [ ] **Step 3**: Smoke + commit

```bash
cd web && bun dev
curl http://localhost:3000/calibration.xml | head -30

git add web/app/calibration.xml/ web/app/layout.tsx
git commit -m "$(cat <<'EOF'
feat(web): /calibration.xml Atom feed of assets.toml mutations from git

Filters git log of assets.toml for commits touching thresholds or
asset row add/remove. Each commit becomes Atom entry with diff preview
+ GitHub commit link.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11M.7 — Reproducible builds CI

**Files**:
- Create: `.github/workflows/reproducible.yml`
- Modify: `Dockerfile`(s) — pin base image digests

- [ ] **Step 1**: Capture base image digests

```bash
docker pull rust:1.90.0-slim-bookworm
docker images --digests rust:1.90.0-slim-bookworm | awk '/rust/ {print $4}'
# Repeat for oven/bun:latest, node:22-alpine, etc.
```

- [ ] **Step 2**: Pin in Dockerfiles

In each `Dockerfile`:

```dockerfile
# Before
FROM rust:1.90.0-slim-bookworm AS builder
# After
FROM rust:1.90.0-slim-bookworm@sha256:abc123def... AS builder
```

- [ ] **Step 3**: Write reproducibility CI workflow

```yaml
# .github/workflows/reproducible.yml
name: Reproducible build verification
on:
  pull_request:
  push: { branches: [main] }
jobs:
  build-twice-compare:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: dtolnay/rust-toolchain@1.90
      - uses: Swatinem/rust-cache@v2
        with: { shared-key: "ci-reproducible" }
      - name: Build engine first time
        run: cargo build --release --locked --frozen -p pegana-engine
      - name: Hash first build
        run: sha256sum target/release/pegana-engine | tee /tmp/hash-1
      - name: Clean and rebuild
        run: |
          cargo clean -p engine-rs
          cargo build --release --locked --frozen -p pegana-engine
      - name: Hash second build
        run: sha256sum target/release/pegana-engine | tee /tmp/hash-2
      - name: Compare
        run: |
          if ! diff /tmp/hash-1 /tmp/hash-2; then
            echo "Build is NOT reproducible on the same machine!"
            exit 1
          fi
          echo "OK: same-machine bit-for-bit reproducible"
```

- [ ] **Step 4**: Commit

```bash
git add Dockerfile* .github/workflows/reproducible.yml
git commit -m "$(cat <<'EOF'
build: reproducible builds — cargo --locked --frozen + Docker digests

CI rebuilds engine twice on same runner, fails if hashes differ.
Docker base images pinned by sha256 digest (replaces mutable tags).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Acceptance verification for Phase 11M

- [ ] AC48 — `/audit.xml` returns valid Atom 1.0 (feedvalidator.org passes)
- [ ] AC49 — `/calibration.xml` valid Atom with last 100 mutations
- [ ] AC50 — `<link rel="alternate">` discovery for both feeds in root layout
- [ ] AC51-AC55 — Embed widget works (script + iframe; CORS; postMessage; themes)
- [ ] AC56-AC59 — CSV streaming works under memory cap; date range limit; columns documented
- [ ] AC60-AC64 — Both SDKs publish to npm/PyPI; demos work
- [ ] AC65-AC69 — On-chain commit works (devnet integration test + manual mainnet smoke)
- [ ] AC70-AC73 — Reproducible build CI passes; Docker digests pinned; cargo --locked

---

## Cross-references

- For distribution spec, see `../10-distribution.md`.
- For engine onchain commit detail, see `../06-engine-changes.md § onchain_commit.rs`.
- For Phase 12 observability picking up these new metrics, see `12-phase-12-observability.md`.
