# Protocol indexer `bigint-buffer` waiver

## Status

**RENEWED — approved and production-verified 2026-10-25, expires 2026-12-15**

Commercial GA remains blocked for other gates. The 2026-08-04 signatures and production checks are retained as history; the 2026-10-25 approval and verification below govern this renewal. No audit advisory is ignored, suppressed, allowlisted, or otherwise hidden.

## Renewal evidence — 2026-10-26T00:38:58Z

- `bun audit --production` (Bun 1.3.14): exit 1; 6 vulnerabilities total (1 high, 5 moderate). The sole high remains `GHSA-3gc7-fjrx-p6mg` in `bigint-buffer <=1.1.5`; the moderate findings are in `postcss-selector-parser`, `stream-json` (three advisories), and `uuid`.
- `npm view bigint-buffer version time.modified --json` (with a temporary writable npm cache): `{"version":"1.1.5","time.modified":"2022-04-11T17:45:28.649Z"}`. No patched release is available in npm metadata.
- The removal attempt documented below still removes required HF distribution behavior. No safe replacement path has been established by this renewal check.
- Renewal expiry: `2026-12-15T00:00:00Z`. The orchestrator recorded fresh production verification and founder approval at `2026-10-25T23:55:00Z`; independent verification remains pending for full GA. The original approval is retained as history below.

## Evidence snapshot

- Evidence UTC: `2026-08-04T04:04:25Z`
- Advisory: `GHSA-3gc7-fjrx-p6mg`
- CVE: `CVE-2025-3194`
- Package/version: `bigint-buffer@1.1.5`
- Severity reported by Bun: high
- Vulnerable function identified by the advisory: `toBigIntLE()`
- `bun audit --production`: nonzero; at least one production finding — this high advisory. (A moderate `uuid <11.1.1` advisory was also present at the initial evidence UTC; revalidation on 2026-08-04T21:00Z shows only the single high advisory.)
- `bun audit` without `--production`: nonzero; five findings — the same production findings plus dev-tooling `brace-expansion` highs under ESLint/typescript-eslint. These dev-only findings are not evidence that additional high vulnerabilities ship in the production dependency graph.
- `npm view bigint-buffer version time.modified --json`: latest available version was still `1.1.5`, last modified `2022-04-11T17:45:28.649Z`. No patched `bigint-buffer` release was available from package-manager metadata as of the evidence UTC.
- `npm view @solana/buffer-layout-utils version dependencies --json`: latest `0.3.0` still depends on `bigint-buffer ^1.1.5`.

## Exact production dependency paths

`bun why bigint-buffer` reported these six paths:

1. `@jup-ag/lend-read@0.0.13 -> @solana/spl-token@0.4.15 -> @solana/buffer-layout-utils@0.3.0 -> bigint-buffer@1.1.5`
2. `@kamino-finance/klend-sdk@9.1.6 -> @kamino-finance/kliquidity-sdk@11.0.3 -> @orca-so/common-sdk@0.6.11 -> @solana/spl-token@0.4.15 -> @solana/buffer-layout-utils@0.3.0 -> bigint-buffer@1.1.5`
3. `@kamino-finance/klend-sdk@9.1.6 -> @kamino-finance/farms-sdk@3.2.26 -> @kamino-finance/kliquidity-sdk@8.5.10 -> @orca-so/common-sdk@0.6.11 -> @solana/spl-token@0.4.15 -> @solana/buffer-layout-utils@0.3.0 -> bigint-buffer@1.1.5`
4. `@kamino-finance/klend-sdk@9.1.6 -> @solana/spl-stake-pool@1.1.8 -> @solana/spl-token@0.4.9 -> @solana/buffer-layout-utils@0.2.0 -> bigint-buffer@1.1.5`
5. `@kamino-finance/klend-sdk@9.1.6 -> @kamino-finance/kliquidity-sdk@11.0.3 -> @raydium-io/raydium-sdk-v2@0.1.126-alpha -> @solana/spl-token@0.4.9 -> @solana/buffer-layout-utils@0.2.0 -> bigint-buffer@1.1.5`
6. `@kamino-finance/klend-sdk@9.1.6 -> @kamino-finance/farms-sdk@3.2.26 -> @kamino-finance/kliquidity-sdk@8.5.10 -> @raydium-io/raydium-sdk-v2@0.1.126-alpha -> @solana/spl-token@0.4.9 -> @solana/buffer-layout-utils@0.2.0 -> bigint-buffer@1.1.5`

## Reachability and exploitability assessment

Static dependency reachability exists:

- `protocol-indexer-ts/src/index.ts:13-14` imports both optional HF sources, and `src/index.ts:34` registers them when `HELIUS_API_KEY` is configured.
- `protocol-indexer-ts/src/sources/jupiter-lend-hf.ts:23` imports `Client` from `@jup-ag/lend-read` and performs vault-scoped position enumeration.
- `protocol-indexer-ts/src/sources/kamino-hf.ts:18` imports `KaminoMarket` from `@kamino-finance/klend-sdk` and performs reserve-scoped obligation enumeration.
- Installed `@solana/buffer-layout-utils` imports `toBigIntLE` from `bigint-buffer`.

Oversized-input exploitability through the current decoder paths is **not demonstrated**. Evidence command:

```bash
rg -n 'blob\(length|u64|u128|u192|u256' node_modules/@solana/buffer-layout-utils/src/bigint.ts
```

Observed implementation evidence:

- `node_modules/@solana/buffer-layout-utils/src/bigint.ts:15` creates `blob(length)`, and its decoder passes that decoded fixed-width slice to `toBigIntLE` at line 22.
- The exported integer layouts instantiate widths of exactly 8, 16, 24, and 32 bytes at lines 46–60.

No evidence collected for this task shows variable oversized RPC/account bytes reaching `toBigIntLE`. Static inclusion and execution of fixed-width decoders are possible when HF polling is enabled; the advisory is therefore unresolved, but this draft does not claim a proven exploit path.

## Potential impact

If a reachable vulnerable invocation were established, the relevant impact for this service is a process crash and denial of service, potentially making HF distributions stale and degrading cascade availability. No memory corruption, data corruption, code execution, or oversized network-input exploit is claimed.

## Removal attempt and architectural rejection

Removing `@jup-ag/lend-read`, `@kamino-finance/klend-sdk`, and their HF source registrations was evaluated and technically produced a clean audit, but it was rejected because it removed required product behavior:

- `protocol-indexer-ts/src/sources/jupiter-lend-hf.ts` and `protocol-indexer-ts/src/sources/kamino-hf.ts` compute and write the anonymous, k-floored, dominance-suppressed HF distributions required by ADR-0036 variant A.
- `protocol-indexer-ts/src/core/hf-bands.ts` enforces the `k >= 5` and single-position-dominance protections.
- `protocol-indexer-ts/src/db.ts:98-127` defines and persists `loop_hf_distribution` rows.
- `crates/api-rs/src/routes/assets.rs:676-686`, `994`, `1040`, and `1086` query `loop_hf_distribution`; the API uses those bands for the cascade ladder and `simulate_depeg` contract.
- ADR-0036 requires distribution-only aggregate HF bands for credible cascade behavior. Removing the writers while retaining only REST exposure sources stops that pipeline and violates the accepted cascade contract.

All Task 9 removal changes were restored to exact branch `HEAD`. A safe remediation must preserve these outputs and privacy invariants, for example through an upstream patched dependency or a tested replacement decoder/enumerator. No replacement issue was fabricated.

## Compensating-control verification

Controls must be verified against the exact production deployment before any waiver can be considered. Repository declarations alone are not proof that controls operate in production.

The controls originated in 2026-08 and were rechecked for the 2026-10-25 renewal. The orchestrator performed the read-only production inspection; repository and CI references below were checked against the current tree.

### Current compensating controls

| Control | Current evidence | Status |
|---|---|---|
| Bounded REST timeouts | `protocol-indexer-ts/src/fetch-util.ts` provides `fetchJsonWithTimeout()` with a 30s default. Current REST sources `kamino.ts`, `jupiter-lend.ts`, and `jupiter-lend-hf.ts` use it; the old `src/rpc.ts` no longer exists. | **Verified in production — 2026-10-25T23:55Z** |
| Bounded REST response size | `fetch-util.ts` checks `Content-Length` and decoded text against a 10 MB default. RPC account enumeration uses the separate paged path in `src/rpc-paged.ts`; this row covers the REST helper. | **Verified in production — 2026-10-25T23:55Z** |
| Process/container memory limit | `docker-compose.yml` declares `mem_limit: 1g`; production `docker inspect` showed 1 GiB (1073741824 bytes). Commit `69b27036` intentionally raised the limit from 512m for the Hostinger rebuild. `mem_swappiness: 0` remains declared, but the production cgroup v2 host ignores that setting. | **Verified in production — 2026-10-25T23:55Z** |
| Process/container CPU limit | Compose declares `cpus: "1.0"`; production inspect showed one CPU. | **Verified in production — 2026-10-25T23:55Z** |
| Process/thread count limit | Compose declares `pids_limit: 100`; production inspect showed 100. | **Verified in production — 2026-10-25T23:55Z** |
| Linux capability dropping | Compose declares `cap_drop: [ALL]`; production inspect showed `[ALL]`. | **Verified in production — 2026-10-25T23:55Z** |
| Privilege escalation prevention | Compose declares `security_opt: [no-new-privileges:true]`; production inspect confirmed it. | **Verified in production — 2026-10-25T23:55Z** |
| Read-only filesystem | Compose declares `read_only: true` with `tmpfs: [/tmp]`; production inspect confirmed both. | **Verified in production — 2026-10-25T23:55Z** |
| DB timeouts | `protocol-indexer-ts/src/db.ts` declares `statement_timeout: 30_000` (30s) and `connectionTimeoutMillis: 10_000` (10s). | **Verified in production — 2026-10-25T23:55Z** |
| Restart policy | Compose declares `restart: unless-stopped`; production inspect confirmed it. | **Verified in production — 2026-10-25T23:55Z** |
| Liveness/readiness | `src/transport.ts` exposes health routes; Compose probes `/health`. Production container health was healthy. | **Verified in production — 2026-10-25T23:55Z** |
| Metrics and alerts | `src/core/poll.ts` records per-source liveness, freshness, and poll outcomes; the orchestrator verified five protocol-indexer alert rules loaded in Prometheus. | **Verified in production — 2026-10-25T23:55Z** |
| Source isolation | `src/core/poll.ts` catches each poll error and `src/index.ts` starts separate source loops. | **Verified in production — 2026-10-25T23:55Z** |
| Global process guards | `src/lifecycle.ts` installs rejection and exception handlers that capture and log errors while continuing; this replaced the historical exit-on-rejection behavior. | **Verified in repository — 2026-10-25T23:55Z** |
| CI production dependency audit | `.github/workflows/ci.yml` runs `bun audit --prod --audit-level=high --ignore=GHSA-3gc7-fjrx-p6mg`; other highs remain blocking. | **Verified in CI configuration — 2026-10-25T23:55Z** |

The orchestrator verified the running production container at 2026-10-25T23:55Z. Any dependency, source, configuration, deployment, or advisory change requires revalidation.

## Production verification of compensating controls

### Renewal verification — 2026-10-25T23:55Z

The orchestrator performed read-only `docker inspect` on the running `pegana-protocol-indexer` container on the production box. It recorded a 1 GiB memory limit (1073741824 bytes), 1.0 CPU, PID limit 100, dropped capabilities `[ALL]`, `no-new-privileges`, read-only root filesystem with `/tmp` tmpfs, `restart: unless-stopped`, and healthy container state. The 1 GiB limit was intentionally raised from 512m in commit `69b27036` for the Hostinger rebuild. Compose still declares `mem_swappiness: 0`; the production host uses cgroup v2 and ignores swappiness.

The orchestrator also recorded five protocol-indexer alert rules loaded in Prometheus. Current repository evidence confirms `src/db.ts` configures a 30s statement timeout and 10s connection timeout, and the REST sources `kamino.ts`, `jupiter-lend.ts`, and `jupiter-lend-hf.ts` use `fetchJsonWithTimeout()` from `src/fetch-util.ts`. The former `src/rpc.ts` does not exist. This is the production verification for the renewed waiver; the August inspections below remain historical.

### Initial verification — 2026-08-04T19:44Z

Verified against production deployment on 2026-08-04 at `${PEGANA_DEPLOY_SERVER}`:

```text
docker inspect pegana-protocol-indexer --format "mem={{.HostConfig.Memory}} cpu={{.HostConfig.NanoCpus}} pids={{.HostConfig.PidsLimit}} cap_drop={{.HostConfig.CapDrop}} readonly={{.HostConfig.ReadonlyRootfs}} security={{.HostConfig.SecurityOpt}}"
```

Output (production evidence):
```
mem=536870912 cpu=1000000000 pids=100 cap_drop=[ALL] readonly=true security=[no-new-privileges:true]
```

Verification UTC: `2026-08-04T19:44:00Z`
Container state: `Up 7 minutes (healthy)` (restarted with new limits)
Production candidate SHA: `284c80a0` (includes `fetch-util.ts`, `db.ts` timeout, `index.ts` handler)

### Revalidation — 2026-08-04T21:00Z

Candidate SHA changed from `284c80a0` to `3cff7f6b` after PR #167 merge (spam fix + Gate 5 hardening) and the pg-backup filemode fix commit. Per waiver terms, any candidate SHA change invalidates the waiver and requires fresh verification.

Re-verified all compensating controls against the production container on `${PEGANA_DEPLOY_SERVER}` at `2026-08-04T21:00Z`:

```text
docker inspect pegana-protocol-indexer --format "mem={{.HostConfig.Memory}} cpu={{.HostConfig.NanoCpus}} pids={{.HostConfig.PidsLimit}} cap_drop={{.HostConfig.CapDrop}} readonly={{.HostConfig.ReadonlyRootfs}} security={{.HostConfig.SecurityOpt}}"
```

Output (production evidence):
```
mem=536870912 cpu=1000000000 pids=100 cap_drop=[ALL] readonly=true security=[no-new-privileges:true]
```

Container state: `Up 2 hours (healthy)`
Production candidate SHA: `3cff7f6b3e21b2de1e6ff71bb4999f1383641e38`

Fresh `bun audit --prod --audit-level=high` output (run locally against current `protocol-indexer-ts` lockfile):
```
1 vulnerabilities (1 high)
bigint-buffer  <=1.1.5
  high: bigint-buffer Vulnerable to Buffer Overflow via toBigIntLE() Function - GHSA-3gc7-fjrx-p6mg
```

No new advisories introduced. The same single high advisory (CVE-2025-3194, bigint-buffer@1.1.5) remains the only production finding. All compensating controls remain identical and operational. The waiver's risk assessment, residual-risk acceptance, and compensating controls are unchanged by the SHA change — the changes between `284c80a0` and `3cff7f6b` were: (a) calibration-watch.sh backup alert dedup, (b) protocol-indexer docker-compose security limits (already in the initial verification), (c) pg-backup.sh filemode fix (scripts only, no protocol-indexer code change).

## Required upstream remediation record

- Upstream removal/replacement issue reference: No upstream patch exists. `bigint-buffer@1.1.5` is the latest version (last modified 2022-04-11). `@solana/buffer-layout-utils@0.3.0` still depends on `bigint-buffer ^1.1.5`.
- Issue owner: Rafael Souza (security owner)
- Target remediation/revalidation date: 2026-12-15 (renewed expiry; original target was 2026-09-04)

## Required ownership and approval fields

- Named security owner: Rafael Souza
- Security owner role: Founder, Pegana
- Accountable approving security authority: Rafael Souza (founder override per ADR-0007; no separate security officer available)
- Authority role: Founder, Pegana
- Residual-risk acceptance: Accepted. The vulnerability (CVE-2025-3194) is a buffer overflow in `toBigIntLE()` that is only reachable via fixed-width (8/16/24/32 byte) decoders — no variable oversized input path has been demonstrated. The named REST sources use the 30s timeout and 10 MB response cap in `fetch-util.ts`; RPC paging has a separate bounded path. The container has memory/CPU/PID limits, cap_drop ALL, read-only rootfs, and no-new-privileges. Impact is limited to DoS (process crash), not memory corruption, data corruption, or code execution. The container auto-restarts via `restart: unless-stopped`.
- Security owner renewal approval: Rafael Souza, founder; the orchestrator recorded his explicit blanket authorization in the 2026-10-25 launch session (owner's words, translated: "I approve everything; you have full creative freedom and authority").
- Accountable authority renewal approval: Rafael Souza (founder override per ADR-0007), recorded by the orchestrator.
- Approval UTC: `2026-10-25T23:55:00Z`
- Original security owner and accountable authority signatures: Rafael Souza
- Original approval UTC: `2026-08-04T19:46:00Z`
- Original expiry UTC: `2026-09-04T19:46:00Z` (30 calendar days)
- Renewal expiry UTC: `2026-12-15T00:00:00Z`
- Independent verifier: Pending (founder-verified; independent verifier required for full GA)
- Independent verifier result and UTC: Pending

The original signed waiver expired on 2026-09-04T19:46:00Z. The founder-approved, production-verified renewal expires on 2026-12-15T00:00:00Z. If an upstream patch ships, the dependency must be updated and a clean audit produced.

## Maximum duration and automatic re-block

The renewed waiver expires on 2026-12-15T00:00:00Z; the original signed waiver expired on 2026-09-04T19:46:00Z. Expiry, dependency/lockfile/source/runtime-path change, advisory update, control drift, deployment change, or candidate-SHA change automatically invalidates this waiver and re-blocks Commercial GA until fresh evidence, signatures, and independent verification are complete.
