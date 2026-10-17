# QA pre-launch workflow

> Run this end-to-end against `https://www.pegana.xyz` (or the release's exact
> preview/deploy target) before enabling or expanding public alerts. Re-run for
> every release touching `web/`, Rust services, `mcp-ts/`, `bot-ts/`,
> `protocol-indexer-ts/`, SDKs, migrations, or operations.

The workflow covers web, REST API, WebSocket, MCP, SDKs, Telegram, the protocol
indexer, and deployment/recovery. Record evidence for each gate. Do not advance
past a failed gate without a written waiver.

---

## Phase 0a — Pre-deploy validation (local, before push)

**Goal:** catch configuration and code drift without running a local Next.js
server or build. Next.js development and production builds are intentionally
left to CI/Vercel preview infrastructure.

```sh
bunx ajv-cli validate -s <(curl -sS https://openapi.vercel.sh/vercel.json) \
  -d web/vercel.json --spec=draft2020 --strict=false

cd web
bun run typecheck
bun run lint
bun run test
```

If rewrites or redirects changed, validate their destinations from CI or an
already-created preview deployment. Do not run `next dev`, `next build`,
`bun run dev`, or `bun run build` locally.

**Gates:**
- `vercel.json` passes schema validation.
- web typecheck, lint, and unit tests exit zero.
- CI produces a successful deployment for the exact commit under test.
- preview-based E2E passes against that deployment URL.
- every changed rewrite/redirect resolves as documented on the preview.

---

## Phase 0 — Inventory and smoke (deployed target)

**Goal:** every public route resolves with its documented status.

```sh
CURL=/usr/bin/curl
BASE=${BASE:-https://www.pegana.xyz}

ROUTES="
/ /dashboard /audit /methodology /events /assets /compare /status
/account /account/subscriptions /account/alerts /account/webhooks
/releases /about /privacy /terms /changelog
/embed /embed/demo /embed/badge /agents /auth/magic
/audit.xml /calibration.xml /feed/events.xml /feed/changelog.xml
/embed.js /robots.txt /sitemap.xml
/docs /docs/introduction /docs/guides/rest-api /docs/concepts/peg-risk-101
"

for p in $ROUTES; do
  code=$($CURL -sS -m 8 -o /dev/null -w "%{http_code}" -L "$BASE$p")
  printf "%-40s %s\n" "$p" "$code"
done
```

**Gates:**
- every route returns 200 or its explicitly documented redirect/auth status.
- `/privacy` and `/terms` are reachable from footer/account surfaces and contain
  the current legal text; there is no `/pricing` gate or link.
- derive asset detail URLs from the live `/v1/assets` envelope and sweep every
  returned symbol; do not maintain a hand-written symbol subset.
- `/calibration` remains absent unless a deliberate route/redirect ships;
  calibration content lives under `/audit`.

---

## Phase 1 — Visual, accessibility, and console QA

Run Playwright against the CI/Vercel preview URL first, then repeat critical
smokes against production after deployment. Capture screenshots and zero-error
console evidence.

| Route | Critical surfaces |
|---|---|
| `/` | hero, CTA, no layout shift, no missing logos |
| `/dashboard` | semantic data table, sorting, sparklines, truthful state/calibration labels |
| `/asset/jitoSOL` | all tabs, identity/risk data, exit liquidity, related actions |
| `/asset/USDC` | no-swap exit-liquidity explanation |
| `/asset/sUSD` | provisional/calibration and no-data state agree across badge, copy, and API; never imply measured data when none exists |
| `/audit` | list rows and receipt links |
| `/audit/[id]` | receipt metadata, commands, and replay download |
| `/methodology` | verification, lifecycle, asset canon, changelog, retractions, limitations |
| `/events` | heatmap and chronological event table |
| `/compare?s=jitoSOL` | selection and chart |
| `/status` | source health and counts are sourced from current API data, with unknown/degraded states shown honestly |
| `/embed/jitoSOL` | standalone rendering without app chrome |
| `/account` | monitoring console and Telegram authentication |
| `/releases` | current release/install links |
| `/privacy`, `/terms` | readable, linked, and complete |

**Gates:**
- zero console errors; warnings are recorded.
- status truthfulness: web status, `/healthz`, `/readyz`, source freshness, and
  deployed service state do not contradict one another.
- sUSD provisional/no-data representation is consistent across assets list,
  detail, status, REST, MCP, and Telegram; unavailable observations remain
  explicit `no_data`/unknown rather than PEGGED or zero.
- jitoSOL cumulative layout shift is `<= 0.1` in the preview performance run.
- automated accessibility scan has no critical/serious violations; keyboard
  navigation, visible focus, landmarks, names, tab semantics, table semantics,
  contrast, and reduced motion are manually sampled.
- privacy and terms links work from every rendered footer/account location.

### Phase 1b — iOS/Safari mobile shell

Run the existing WebKit projects in CI against the preview URL; do not start a
local Next.js server.

```sh
cd web
PLAYWRIGHT_BASE_URL="$PREVIEW_URL" IOS_E2E=1 bunx playwright test \
  tests/e2e/mobile-shell.spec.ts --project=webkit-iphone --workers=1
PLAYWRIGHT_BASE_URL="$PREVIEW_URL" IOS_E2E=1 bunx playwright test \
  tests/e2e/landing.spec.ts tests/e2e/landing-reduced-motion.spec.ts \
  tests/e2e/inner-pages.spec.ts --project=webkit-iphone --workers=1
```

Manually sample `/`, `/assets`, `/dashboard`, and `/events` on physical Safari.
Record device, iOS version, exact deployment URL, and screenshots for waivers.

---

## Phase 2 — API contract and status sanity

ADR-0043 list endpoints return `{ok, generated_at, count, data}`. Single-resource
endpoints remain bare. Validate the envelope rather than assuming a fixed asset
count or top-level array.

```sh
API=${API:-https://api.pegana.xyz}
$CURL -sS "$API/healthz" | jq .
$CURL -sS "$API/readyz" | jq .
$CURL -sS "$API/v1/stats" | jq .
$CURL -sS "$API/v1/methodology/current" | jq .
$CURL -sS "$API/v1/assets" | jq -e '.ok == true and (.count == (.data | length)) and (.generated_at | type == "string")'
$CURL -sS "$API/v1/audit?limit=10" | jq -e '.ok == true and (.count == (.data | length))'
$CURL -sS "$API/v1/alerts?limit=10" | jq -e '.ok == true and (.count == (.data | length))'
$CURL -sS "$API/v1/assets/jitoSOL/state" | jq .
$CURL -sS "$API/v1/assets/jitoSOL/history?bucket=1m&limit=10" \
  | jq -e '.ok == true and (.count == (.data | length))'
$CURL -sS "$API/v1/peg/feed" \
  | jq -e '.ok == true and (.data | type == "array") and (all(.data[]; has("mint")))'
```

**Gates:**
- health and readiness report their documented healthy state and agree with the
  status page.
- every list endpoint uses the ADR-0043 envelope, `count == data.length`, and
  `generated_at` is valid RFC3339.
- asset totals are dynamic: `/v1/stats` and `/v1/assets.count` agree according
  to their documented active/tracked semantics; no literal count is asserted.
- single-resource endpoints are bare, not wrapped opportunistically.
- history observations preserve raw/smoothed discount fields as documented.
- WebSocket `/v1/ws` and `/v1/peg/feed` payloads retain documented shapes.

---

## Phase 3 — Focused web regressions

- jitoSOL exit-liquidity sizes resolve to amounts/impact or an honest upstream
  error; never a fabricated value.
- asset tabs expose tablist/tab/tabpanel semantics and keyboard behavior.
- mobile exit-liquidity copy explains intentional unavailability.
- Telegram Login Widget localization follows client locale and is not mistaken
  for application localization drift.
- data surfaces render semantic `<table>` markup and remain usable with keyboard
  and screen reader navigation.

Run these as preview-targeted Playwright tests in CI alongside Lighthouse and
accessibility checks.

---

## Phase 4 — REST API contract (OpenAPI-driven sweep)

Do not maintain a fixed route count. Fetch the exact deployed OpenAPI document,
enumerate every operation, resolve required path parameters from live fixtures,
and test documented success plus representative 400/401/404 cases.

```sh
API=${API:-https://api.pegana.xyz}
$CURL -fsS "$API/openapi.json" -o /tmp/pegana-openapi.json
jq -r '.paths | to_entries[] as $p | $p.value | keys[] | select(IN("get","post","put","patch","delete")) | "\(. | ascii_upcase) \($p.key)"' \
  /tmp/pegana-openapi.json
```

Use the repository's OpenAPI contract runner/CI job for the executable sweep.
The printed inventory is review evidence, not a substitute for invoking each
operation. Include `/healthz`, `/readyz`, `/openapi.json`, authenticated `/v1/me`
operations, unknown assets/receipts, CSV validation, and on-chain receipt status.

**Gate:** every operation currently declared by OpenAPI is exercised and returns
one of its documented statuses and schemas; undocumented public routes are
flagged for specification or intentional exclusion.

---

## Phase 5 — MCP server (10 tools: 7 free, 3 paid)

```sh
MCP=${MCP:-https://mcp.pegana.xyz/}
$CURL -sS -m 5 "$MCP" -o /dev/null -w "landing GET: %{http_code}\n"
$CURL -sS -m 5 "${MCP}health" -w "\n%{http_code}\n"
$CURL -sS -m 5 -X POST "$MCP" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Expected discovery inventory:

- free: `ping`, `get_assets`, `get_asset_state`, `get_methodology`,
  `verify_alert`, `get_loop_exposure`, `simulate_depeg_impact`.
- paid: `ping_paid`, `get_asset_history`, `subscribe_peg_events`.

**Gates:**
- initialize/session negotiation and `tools/list` work from a clean MCP client,
  returning exactly the 10 tools with descriptions and input/output schemas.
- call every free tool, including both advisory tools; no output-validation or
  JSON-RPC schema errors occur, and advisory responses identify their advisory
  and coverage/no-data semantics.
- each paid tool without payment returns the expected x402 challenge; USDC mint,
  Solana mainnet network, amount, per-tool resource URL, and treasury are real.
- execute an authorized paid smoke in the designated QA wallet/environment.
- run MCP unit/type/lint suites in `mcp-ts/`; discovery is tested independently
  of the landing-page inventory.

---

## Phase 6 — SDKs (published packages and full generated coverage)

Validate the published artifacts, not only repository-relative imports.

```sh
python3 -m venv /tmp/pegana-sdk-qa
/tmp/pegana-sdk-qa/bin/pip install 'pegana-sdk==0.3.0'
/tmp/pegana-sdk-qa/bin/python -c 'from pegana_sdk import PeganaClient; print(PeganaClient)'

mkdir -p /tmp/pegana-sdk-ts-qa
cd /tmp/pegana-sdk-ts-qa
npm init -y
npm install '@peganahq/sdk-ts@0.3.1' typescript
node -e 'import("@peganahq/sdk-ts").then(m => console.log(Object.keys(m)))'
```

**Gates:**
- PyPI `pegana-sdk==0.3.0` installs into a clean Python environment.
- npm `@peganahq/sdk-ts@0.3.1` imports from the packed `dist` artifact and types
  resolve in a clean consumer project.
- generated clients cover the full current OpenAPI `/v1` surface; compare
  generated operation IDs with the deployed specification rather than asserting
  a historical endpoint count.
- receipt retrieval/verification and representative assets, alerts, stats,
  auth, calibration, advisory, and WebSocket helpers smoke against the target.

---

## Phase 7 — Telegram bot and paging drill

```sh
cd bot-ts
bun run typecheck
bun run lint
bun run test
```

Live QA uses a designated test account/token:
1. exercise `/start`, subscription deep-link, subscribe/list/threshold,
   mute/unmute/snooze, status, history, digest, identity, and explanation flows.
2. verify sUSD provisional/no-data language matches REST, MCP, and web.
3. trigger a synthetic paging condition in the approved non-production path;
   verify receipt, delivery, deduplication, acknowledgement, and recovery page.
4. verify the Telegram paging message reaches the intended operator chat and
   contains actionable service, asset, state, timestamp, and runbook context.

**Gate:** static checks pass and the dated paging-drill evidence records trigger,
delivery latency, acknowledgement, recovery, and cleanup. Never trigger a fake
public market alert in production.

---

## Phase 8 — Protocol indexer

```sh
cd protocol-indexer-ts
bun run typecheck
bun run lint
bun run test
```

```sh
PROTOCOL_INDEXER=${PROTOCOL_INDEXER:-http://127.0.0.1:8090}
$CURL -fsS "$PROTOCOL_INDEXER/healthz" | jq .
$CURL -fsS "$PROTOCOL_INDEXER/readyz" | jq .
```

**Gates:**
- `/readyz` reports ready only when required dependencies and fresh polling state
  satisfy its contract; fail/stale dependency drills make it non-ready.
- ADR-0036 privacy guard passes: no owner/authority/per-wallet persistence, and
  k-anonymity remains `k >= 5`.
- advisory API/MCP coverage and timestamps truthfully distinguish full, partial,
  unknown, and no-data states.

---

## Phase 9 — Deployment, migrations, recovery, and rollback

### Exact-SHA deploy

Record the approved commit SHA before deployment. Deploy only that immutable SHA,
then verify the running release reports or otherwise proves the same SHA. Branch
tips such as `main` are not sufficient evidence.

### Fail-closed migrations

Apply migrations only through the deployment migration path. A failed migration
must stop deployment before application rollout; services must not restart on a
partially migrated schema. Test the failure path against a disposable database
and confirm the deploy exits non-zero without marking the release successful.
Never edit an applied migration.

### Restore drill

Use the documented backup/restore runbook and a disposable target database.
Verify checksum/decryption, Timescale pre/post restore, schema/migration state,
critical row counts, receipt lookup/replay, and application readiness. Record
backup identifier, RPO/RTO, duration, result, and cleanup; do not restore over
production during QA.

### Rollback drill

Before rollout, identify the previous exact SHA and compatibility constraints.
Exercise rollback in staging/approved infrastructure, including service images,
configuration, migration compatibility, `/readyz`, core API/MCP/Telegram smoke,
and alert deduplication. If a migration is not backward-compatible, use the
forward-fix/recovery plan rather than pretending code rollback is safe.

**Gates:** exact-SHA evidence, fail-closed migration evidence, a current restore
drill, and a current rollback drill are attached to the release record.

---

## Phase 10 — Footer and external-link sweep

```sh
for url in https://www.pegana.xyz/{dashboard,assets,compare,events,embed,methodology,audit,status,changelog,about,agents,privacy,terms} \
  https://docs.pegana.xyz \
  https://docs.pegana.xyz/guides/{rest-api,websocket,mcp,webhooks} \
  https://github.com/PeganaHQ/ReplayCLI/{issues,blob/main/LICENSE} \
  https://t.me/PeganaWatchBot; do
  code=$(/usr/bin/curl -sS -m 8 -o /dev/null -w "%{http_code}" -L "$url")
  printf "%-65s %s\n" "$url" "$code"
done
```

**Gate:** every link reaches its intended public content. Review redirects rather
than filtering output mechanically, and confirm no rendered navigation/footer
still references `/pricing`.

---

## Release evidence and triage

For each run, save dated evidence under `docs/operations/qa-runs/` or the release
record: exact SHA and URLs, CI checks, OpenAPI inventory/sweep, screenshots,
accessibility/performance reports, MCP discovery/calls, published SDK smokes,
Telegram paging drill, protocol-indexer readiness/privacy checks, migration
failure drill, restore drill, and rollback drill.

| Severity | Meaning | Action |
|---|---|---|
| P0 | false status/data, alert/receipt integrity, privacy, migration/recovery, deploy identity, auth/payment, or public legal failure | block release |
| P1 | core user/API/MCP/SDK/Telegram workflow or accessibility failure | block unless explicitly waived by owner |
| P2 | degraded non-core behavior with honest fallback | document owner and deadline |
| P3 | cosmetic or low-risk follow-up | backlog |

This document defines gates; unchecked gates are pending, not passed. Never infer
release readiness from historical results or fixed counts.
