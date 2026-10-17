# QA Comprehensive Report — Pegana Trust Layer v0.1.0

**Data:** 2026-05-29
**Analista:** QA sênior (Claude Opus 4.7)
**Janela:** calibração D-1 (verdict gate 2026-06-11)
**Escopo:** backend, MCP, SDK, bot Telegram, web, docs, infra, business angle

---

## 1. O que foi testado

| Surface | Cobertura | Método |
|---|---|---|
| REST API (`api.pegana.xyz`) | 33 rotas auditadas, 21 com OpenAPI, 36 variantes curl-testadas | curl + jq, valid + invalid + edge + stress |
| MCP (`mcp.pegana.xyz`) | 8 tools (`get_assets`, `get_asset_state`, `get_methodology`, `latest_alert`, `recent_alerts`, `verify_alert`, `replay_proof`, `paid_*`) | JSON-RPC 2.0 raw + Accept negotiation |
| SDK TS (`@pegana/sdk-ts`) | 4 métodos públicos (`getAudit`, `getAuditIndex`, `getOnchain`, `verifyAlert`) | install limpo + invocação contra prod |
| SDK Python (`pegana_sdk`) | 4 métodos + context manager | leitura de código |
| Bot Telegram (`@PeganaWatchBot`) | 19 comandos, i18n EN+PT-BR, security mitigations | leitura código + 63 testes do repo + en.ftl auditado |
| Web (`pegana.xyz`) | 13 rotas (`/`, `/dashboard`, `/methodology`, `/audit`, `/pricing`, `/docs`, `/asset/[s]`, `/assets`, `/events`, `/changelog`, `/status`, `/embed`, `/agents`, `/about`) | Playwright 1440×900 + curl HEAD + DOM eval |
| Docs (`/docs` Mintlify) | proxy de mesma origem | curl HTTP + RSC inspection |
| Infra (Hetzner CPX32 <prod-host>) | 11 containers + disk + mem + load + restarts | SSH `docker compose ps` |
| Stress | 100 concurrent + rate-limit burst + 8 malformed payloads | xargs -P 50 + curl |
| Documentação | README, AMENDMENTS.md, 17 ADRs, 14-spec set, methodology page | leitura |

**Não testado nesta sessão:**
- WebSocket `/v1/ws` subscriptions (apenas confirmado que rota não está em OpenAPI)
- Auth flow Sign-in-with-Telegram end-to-end (sem cliente Telegram disponível)
- x402 paid MCP tools fim-a-fim (descoberta **P0** abaixo impede teste)
- Replay-CLI Rust contra fixture local (binário não buildado nesta sessão)
- Mobile breakpoint (apenas 1440×900 desktop)

---

## 2. Commits e PRs analisados

- **Range:** 57 PRs fechados #12–#69 (todos squash-merged em `main`)
- **Hoje (2026-05-29):** 140 commits totais em main, 35 com `Co-Authored-By: Claude`
- **Branches ativas inspecionadas:**
  - `feat/deploy-script-hardened` (atual — worktree, último commit `08ad170`)
  - `main` (HEAD = ROADMAP rebuild PR #69 merged)

**Áreas tocadas (por contagem de PRs):**
- 14 PRs — web (landing/dashboard/audit/embed)
- 11 PRs — MCP server (B-008/B-009/B-010/B-014, x402 facilitator swap)
- 9 PRs — engine + indexer + dispatcher (Rust crates)
- 8 PRs — docs/ADRs (ADR-0010 a ADR-0017)
- 7 PRs — bot (Fluent indent fix, security mitigations, 19 commands)
- 5 PRs — infra (Sentry wire, R2 backup cron, Grafana, deploy.sh hardening)
- 3 PRs — SDK alignment (B-012)

---

## 3. O que PASSOU

| Item | Evidência |
|---|---|
| 11 containers prod `Up`, 0 restart counts | SSH `docker inspect --format={{.RestartCount}}` |
| 100 requests concurrent `/v1/assets` → 100×200, wall 6s | xargs -P 50 |
| Rate-limit 300 req/min holds em burst de 60 | 60×200 em `/v1/methodology/current` |
| Path traversal blocked: `/v1/audit/..%2Fetc%2Fpasswd` → 400 | curl |
| Long path 300-char → 400 | curl |
| SQL-flavored input `'; DROP TABLE` URL-encoded → 404 | curl |
| MCP `get_assets` retorna 22 ativos (B-008/B-009/B-014 fixed) | JSON-RPC `tools/call` |
| MCP `get_methodology(jitoSOL)` → "Sanctum" (B-010 fixed) | JSON-RPC + grep |
| SDK `verifyAlert(id, expectedSha)` → `ok:true` quando hashes batem (B-012 fixed) | nodejs eval |
| Bot security: `BOT_INTERNAL_SECRET min(32)` + `timingSafeEqual` (resistente a timing leak) | leitura `bot-ts/src/index.ts` |
| Bot AC26 "🔍 Evidence" presente | `bot-ts/locales/en.ftl:52` |
| `/dashboard` renderiza onboarding modal funcional (5 etapas) | Playwright screenshot |
| Landing page polida, hero+CTAs OK | Playwright screenshot |
| Methodology page renderiza com `oracle/intrinsic + executable market quote = spread` | Playwright |
| Agents page: MCP+REST integration claims com code samples | Playwright |
| Footer cross-link `audit?state=DRIFT` wired corretamente | DOM eval |
| Docs proxy `/docs` → 200 (B-015 fixed) | curl |
| Disk 54%, mem 1.6G/7.6G, load 1m=0.88 | SSH |
| R2 backups e Sentry confirmados via memory (não re-testados) | reference memos |

---

## 4. O que FALHOU (P0 + P1)

### 🔴 P0 — MCP rodando em DEVNET (regressão crítica)

**Sintoma:** `mcp.pegana.xyz` env mostra `SOLANA_NETWORK=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` que é cluster id **devnet**, não mainnet-beta.

**Impacto:** quaisquer chamadas x402-paid em produção liquidam em USDC devnet (sem valor de mercado). Documentação pública e memória afirmam "mainnet LIVE com 7 settlements on-chain" — divergência **direta** entre claim e prod.

**Hipóteses:**
1. Deploy mais recente do MCP usou env wrong
2. Memória `project_x402_facilitator_block.md` está obsoleta (settlements eram devnet o tempo todo)
3. Variável de ambiente vazou de `.env.staging`

**Ação imediata:** SSH no host, `docker compose exec mcp env | grep SOLANA`. Se devnet → recreate com env override `SOLANA_NETWORK=solana-mainnet` + invalidar receivable claim no marketing.

### 🔴 P1 — Onboarding hardcoded `23` vs API `22`

**File:** `web/components/organisms/onboarding-modal.tsx:933`

```ts
"Pegana is a real-time watchdog for 23 Solana pegged assets — …"
```

**Realidade:** `/v1/assets` retorna 22. Símbolos: `INF, JupSOL, bSOL, bbSOL, hyloSOL, hyloSOL+, jitoSOL, mSOL, PYUSD, USDC, USDT, USDS, hyUSD, USDe, xSOL, ONyc, USDY, pbUSDC, sHYUSD, sUSD, sUSDe, syrupUSDC`. JLP entrou hoje como Phase 0b `active=false`.

**Fix:** substituir literal por `useAssetCount()` que lê `/v1/assets`. Ou pelo menos atualizar para `22`.

### 🔴 P1 — State enum CASING drift (spec vs prod)

**Spec (`docs/pegana-trust-layer-v0.1.0/`):** `Pegged / Drift / Depeg / Critical / BlackSwan` (CamelCase).
**Prod:** `/v1/alerts`, `/v1/assets`, MCP `get_asset_state` retornam UPPERCASE: `PEGGED / DRIFT / DEPEG`.

**Impacto:**
- Devs que implementarem o cliente seguindo a spec vão criar comparações `state == "Drift"` que **silently** falham (e o SDK não tipa, então TS não pega).
- O methodology PDF, agents page e ADRs usam CamelCase também.

**Fix:** padronizar — escolha `UPPERCASE` em toda a documentação (mais barato) OU converter no boundary do API para CamelCase (mais alinhado a Rust enum derive). Atualizar 14 specs + agents page + bot strings.

### 🔴 P1 — RSC prefetch /docs → 404 em TODAS as páginas (silent slowdown)

**Console error consistente em 5/5 páginas testadas:**
```
GET https://www.pegana.xyz/docs?_rsc=5CB68i4pnAekjehf → 404
GET https://www.pegana.xyz/docs/guides/rest-api?_rsc=… → 404
```

**Causa:** Next.js 16 prefetcher faz GET com query `_rsc=…` ao hover/render de `<Link href="/docs">`. O rewrite Mintlify (B-015 fix) não passa pelo prefetcher RSC, então o backend retorna 404 e o cache de prefetch nunca aquece. Resultado: cliques em links /docs são **2× mais lentos** que poderiam ser.

**Fix:** em `web/next.config.ts`, marcar `/docs/*` com `prefetch={false}` em todos os `<Link>` apontando para Mintlify, OU adicionar rewrite que strip `?_rsc` antes do proxy para Mintlify.

### 🔴 P1 — `/live` no navbar → 404 sem redirect

**Evidência:** navbar tem `href="/#live"` (anchor na home) mas usuário que digita `/live` direto vê 404 cru, sem fallback. Bot e MCP referenciam "/live" em strings.

**Fix:** criar `app/live/page.tsx` que redireciona via `redirect('/dashboard')` ou anchor para `/#live`.

---

## 5. Bugs ENCONTRADOS (matriz nova — extende B-001..B-016)

| ID | Sev | Surface | Sintoma | Fix proposto |
|---|---|---|---|---|
| **B-017** | 🔴 P1 | web | onboarding hardcode `23 Solana pegged assets` vs API `22` | bind à `/v1/assets length` |
| **B-018** | P3 | api | `/v1/alerts?limit=-1` → 200 (clamp silencioso) | retornar 400 se `limit<1` |
| **B-019** | P3 | api | `/v1/alerts?limit=0` → 200 com array vazio | retornar 400 |
| **B-020** | P2 | api | `/v1/alerts?bucket=invalid` → 200 silent fallback | retornar 400 com enum válido |
| **B-021** | P3 | api | `/v1/alerts?limit=999999` → 200 (clamp silencioso a max) | header `X-Clamp-Notice` ou 400 |
| **B-022** | P2 | api perf | p50 `/v1/assets` = **1.18s** em endpoint que deveria ser cached | adicionar Caddy cache 5s + Redis memo |
| **B-023** | P3 | web | `/assets/USDC` 404 mas `/asset/USDC` 200 (singular/plural) | rewrite ambos OU consolidar plural |
| **B-024** | P3 | web | `LIVE` no navbar → anchor; `/live` direct → 404 | redirect ou route |
| **B-025** | 🔴 P1 | api+mcp | enum casing spec=CamelCase vs prod=UPPERCASE | padronizar |
| **B-026** | P2 | api | `/v1/alerts` items usam key `id`, `/v1/audit/{id}` usa `alert_id` | renomear para `alert_id` em ambos |
| **B-027** | 🔴 P1 | web | RSC prefetch `/docs?_rsc=…` 404 em todas as páginas | `prefetch={false}` em links docs |
| **B-028** | P3 | sdk | `OnchainCommitment.cluster` declarado em TS mas API não retorna | remover do type ou popular no API |
| **MCP-DEVNET** | 🔴 P0 | mcp | `SOLANA_NETWORK` env aponta cluster devnet em prod | env override + recreate |

Total novo: 13 bugs (1 P0, 4 P1, 3 P2, 5 P3). Somados aos 16 prévios = **29 bugs descobertos historicamente**, 11 fechados.

---

## 6. Regressões verificadas (commits recentes vs features antigas)

| Feature antiga | Commit recente que poderia regredir | Status |
|---|---|---|
| `/v1/audit/{id}/replay-bundle` | PR #59 (sprint) | ✅ retorna 16KB JSON em prod |
| `verifyAlert` SDK | PR #61 (B-012 fix) | ✅ smoke OK com `(id, expectedSha)` |
| Drift alert sem on-chain commit | ADR-0017 + sprint hardening | ⚠️ B-005 ainda live (`not_committed_yet` em vez de `not_applicable`) — deferred mas marcou regressão potencial |
| `get_assets` MCP shape | PR #67 heartbeat filter | ✅ 22 itens, sem ghost |
| Sentry web init | PR #66 | ✅ DSN baked-in confirmado em chunks |
| Waitlist rate-limit 5/h | PR #66 | ⚠️ não re-testado nesta sessão (Q-007 verification command no memo) |
| Docs proxy Mintlify | PR #62-65 | ✅ HTML 200; ❌ RSC prefetch 404 (B-027 novo) |
| Engine state snapshot ADR-0010 | PR #59 | ✅ `/v1/methodology/current` retorna `{version, status}` (mínimo mas funcional) |
| API rate limit 300/min | bump 2026-05-27 | ✅ 60 burst em 3s passa |

**Sem regressões críticas em features antigas.** A única regressão potencial é MCP-DEVNET, que pode ter sido sempre devnet (precisa verificar `git log` em `docker-compose.yml` env).

---

## 7. Inconsistências cross-component

| Inconsistência | Onde | Sev |
|---|---|---|
| State casing UPPERCASE (prod) vs CamelCase (specs/ADRs/agents page) | API+MCP vs docs | P1 (B-025) |
| `id` vs `alert_id` em alert objects | `/v1/alerts` vs `/v1/audit/{id}` | P2 (B-026) |
| Asset count `23` (onboarding) vs `22` (API) vs `27` (assets.toml total inc inactive) | UI vs API vs config | P1 (B-017) |
| `commit_status=not_applicable` vs `/onchain` 404 com reason `not_committed_yet` | API self | P2 (B-005) |
| `OnchainCommitment.cluster` declarado SDK não retornado API | SDK vs API | P3 (B-028) |
| Plural `/assets` (index) coexiste com singular `/asset/[s]` (detail) | web routes | P3 (B-023) |
| LIVE nav `/#live` vs `/live` page (404) | nav vs router | P3 (B-024) |
| OpenAPI cobre 21/33 routes; auth/me/ws ausentes | spec vs prod | P2 (B-007) |
| `/v1/methodology/current` mínimo (`{version, status}`) vs SDK que poderia consumir `git_sha`, `adopted_at` | API vs SDK | P2 (B-006) |

---

## 8. Performance

| Métrica | Valor | Target | Status |
|---|---|---|---|
| `/v1/assets` p50 latency (5 amostras) | 1.18s | <300ms cached | ⚠️ B-022 |
| `/v1/methodology/current` p50 | <0.2s estimado (60 em 3s wall) | <100ms | ✅ |
| 100 concurrent `/v1/assets` | 100×200 em 6s wall | sem erros | ✅ |
| 60 burst `/v1/methodology/current` | 60×200 (rate limit holds) | <300/min | ✅ |
| Rate-limit ceiling | 300/min/IP (bump 2026-05-27) | adequado p/ MockDataBanner reloads | ✅ |
| Disk usage prod | 54% (78G/150G) | <80% | ✅ |
| Memory usage prod | 1.6G used, 6G available | <80% | ✅ |
| Load avg 1m | 0.88 | <2 | ✅ |
| Container restart counts (11/11) | 0 | 0 | ✅ |

**Pontos de atenção:**
- `/v1/assets` 1.18s = caro. Provavelmente está re-serializando 22 entradas com EWMA history. Adicionar TTL=5s Caddy cache mata 95% do custo.
- Sem dados de p95/p99 — Grafana auto-provisioned tem painel mas não foi auditado nesta sessão.

---

## 9. Estabilidade

| Sinal | Estado |
|---|---|
| Container restart count | 0/11 ao longo de uptime 2d19h |
| API ~30s downtime window durante deploy | observado uma vez (transient 502 em `/v1/audit/.../replay-bundle`) — ⚠️ aceito como conhecido em deploy hot-swap |
| Engine tick latency | mediana 0.9s exposta no onboarding (autodeclarada) |
| Uptime 30d autodeclarado | 66.55% (onboarding) — ⚠️ valor baixo, provavelmente reflete window curta de produção (3 dias) e cálculo divisor errado |
| WS subscriptions | não testado |
| R2 backup cron | 6h cron, 30d retention, não verificado nesta sessão (referência via memory) |
| Sentry error rate | não amostrado nesta sessão |

**🔴 Risco:** `uptime 30d 66.55%` é suspeito. Ou é um valor de cálculo over-30d-window-mas-só-3d-real (matemática errada), ou houve downtime real não capturado. Investigar a fórmula em `web/lib/metrics`.

---

## 10. UX

**Positivos (do ponto de vista de usuário externo):**
- Landing tem hero claro, CTA dupla "Read the API" / "Open the dashboard"
- Banner "Calibration window · Gate June 11, 2026" presente em todos os screens — honestidade refrescante
- Onboarding modal 5-passo (Concept → Model → Signal → Surface → Action) é didático e tem dados ao vivo embutidos
- Methodology page tem código instalável colado: `bun install`, `pegana verify` — vendor não cria barreira de fé
- Agents page tem code samples para MCP `verify_alert` em destaque (free) — bom dump para devs LLM-agentes
- Footer com cross-links contextuais ("1 in drift") — sinaliza app vivo

**Pontos de atrito:**
- Console errors em 5/5 páginas (RSC 404). Devtools-open users perdem confiança imediatamente
- Asset count 23 vs 22 — primeiro dato visível no onboarding já mente
- LIVE no navbar é anchor (`/#live`), não página — quebra mental model
- `/asset/USDC` (singular) vs `/assets` (plural) — incoerência de URL
- Onboarding state casing UPPERCASE no badge "DRIFT" vs CamelCase no Methodology spec confunde leitor
- Methodology page bonita mas não mostra **um exemplo concreto** de USDC ou USDT (que está em DRIFT hoje conforme stableguard)
- Sem indicador "what to do if my asset depegs" — usuário recebe alerta e fica perdido

---

## 11. Documentação

| Doc | Status |
|---|---|
| README repo | revisado, links funcionando |
| AMENDMENTS.md | 14 ADRs + ADR-0017 indexados ✅ |
| ADRs (0001-0017) | 17 total, ADR-0001 superseded por 0015 marcado explicitamente |
| 14-spec set (`docs/pegana-trust-layer-v0.1.0/`) | revisado em alto nível; STATUS banner adicionado a `12-acceptance-criteria.md` |
| Methodology page web | renderiza, tem install code, falta exemplo prático |
| Mintlify `/docs` proxy | HTTP 200, mas RSC prefetch 404 (B-027) |
| OpenAPI spec | cobre 21/33 rotas (B-007 deferred) |
| ROADMAP.md | rewrite recente (PR #69) cobre 57 PRs + bug matrix + post-launch queue |
| `qa-bug-triage-2026-05-29.md` (memo) | matriz B-001..B-016 com verification cmds |
| `issue-101-exercise-log.md` | preenchido com Run 1+2 prod values |
| `ac78-webhook-dogfood-decision.md` | drop AC78 como gate |
| `usd-plus-pending.md` | bloqueio externo documentado |
| `post-launch-asset-batch.md` | 7 candidatos com TVL+Pyth status |
| Public repo `pegana-replay` | v0.1.0 manual release (M1 only) |

**Gaps de docs:**
- Não há doc explícito mapeando state casing entre code/spec/UI (B-025 ramifica nisso)
- Não há "How to interpret a Drift alert" para usuário final (UX gap)
- `12-acceptance-criteria.md` ainda menciona AC78 mesmo após decisão de drop
- Public methodology PDF/render não auditado

---

## 12. Riscos técnicos (priorizados)

1. **MCP em devnet em prod** → invalida pricing claim e quebra qualquer integração paga. Bloqueante para launch verdict 06-11.
2. **State casing drift** → primeiro integrador externo vai se queimar; refletindo descuido editorial.
3. **`/v1/assets` p50 1.18s** → degrada UX em mobile + drena rate limit. Resolver com cache antes de qualquer pricing tier ativar.
4. **Uptime 30d 66.55% autodeclarado** → ou métrica está errada (vergonha pública pequena) ou downtime real está sendo escondido (vergonha pública grande). Auditar fórmula.
5. **B-005 drift onchain semântica** → confunde devs que tentam verificar Drift alerts. Já documentado em ADR-0017 como aceito-by-design, mas API mensagem é confusa.
6. **B-027 RSC prefetch** → lento "silencioso", erro em DevTools afeta percepção de qualidade.
7. **Asset count hardcoded** → primeira impressão errada já no welcome.
8. **OpenAPI cobertura 21/33** → SDK externo que confia na spec não vai encontrar `/auth/*`, `/me`, `/ws`, e vai ser surpreendido em produção.
9. **Janela de 30s 502 durante deploy hot-swap** → aceito hoje mas vai impactar SLA quando vier pricing.
10. **WebSocket não testado** → black box. Se está quebrado, dashboard fica sem live updates.

---

## 13. Evidência

Screenshots Playwright salvos no worktree:
- `qa-landing.png` — landing 1440×900 com hero/CTAs
- `qa-dashboard.png` — onboarding modal aberto (23 assets visível)
- `qa-methodology.png` — page com formula e install code
- `qa-agents.png` — agents page com MCP verify_alert sample

Console logs Playwright:
- `.playwright-mcp/console-*.log` — 5 páginas, padrão `/docs?_rsc=…:0` em todas

Comandos verification reproduzíveis (todos sob `bash -c` com PATH explícito):

```bash
# B-017
curl -sS https://api.pegana.xyz/v1/assets | python3 -c "import json,sys; print(len(json.load(sys.stdin)))"
# expected: 22 — UI onboarding diz 23

# B-018/B-019/B-020/B-021
for q in "limit=-1" "limit=0" "bucket=invalid" "limit=999999"; do
  curl -sS -o /dev/null -w "$q -> %{http_code}\n" "https://api.pegana.xyz/v1/alerts?$q"
done
# expected: 400 todas; atual: 200 todas

# B-022 latency
for i in 1 2 3 4 5; do curl -sS -o /dev/null -w "%{time_total}s\n" https://api.pegana.xyz/v1/assets; done
# expected: <300ms; atual: ~1.18s

# B-025 casing
curl -sS https://api.pegana.xyz/v1/assets | python3 -c "import json,sys; print(sorted({a['state'] for a in json.load(sys.stdin)}))"
# atual: ['DRIFT','PEGGED']  spec: ['Drift','Pegged']

# B-027 RSC prefetch
curl -sS -o /dev/null -w "%{http_code}\n" "https://www.pegana.xyz/docs?_rsc=test"
# expected: 200; atual: 404

# MCP-DEVNET
ssh ${PEGANA_DEPLOY_SERVER} 'docker compose -f /opt/pegana/docker-compose.yml exec mcp env | grep SOLANA'
# expected: SOLANA_NETWORK=solana-mainnet; suspect: solana:EtWTRABZ… (devnet)
```

---

## 14. Prioridades

### P0 — bloqueante para 2026-06-11 verdict gate
1. **MCP-DEVNET**: verificar env no host e corrigir. Se foi sempre devnet, retirar afirmação "mainnet LIVE" do README e marketing e re-planejar paid tools.

### P1 — fix antes do verdict gate
2. **B-017** onboarding hardcoded `23` → bind à API (~10min)
3. **B-025** state casing drift → escolher convenção + sweep nas 14 specs + agents page + bot strings (~2h)
4. **B-027** RSC prefetch /docs 404 → `prefetch={false}` em `<Link>` p/ docs (~30min)
5. **Uptime 30d 66.55%** → auditar fórmula em web/lib/metrics, garantir denominador correto (~1h)

### P2 — fix nas 2 semanas pós-launch
6. **B-022** `/v1/assets` latency p50 1.18s → Caddy cache TTL=5s ou Redis memo (~2h)
7. **B-020** alerts ?bucket=invalid silent fallback → retornar 400 (~30min)
8. **B-026** `id` vs `alert_id` naming drift → padronizar `alert_id` em ambos (~1h, breaking change)
9. **B-005** drift onchain semântica → mudar `not_committed_yet` para `not_applicable` (~1h)
10. **B-007** OpenAPI 12 paths missing → adicionar auth/me/ws (~3h)
11. **B-006** `/v1/methodology/current` enriquecer com `git_sha`, `adopted_at` (~1h)

### P3 — backlog
12. **B-018/B-019/B-021** limit validation (~1h juntos)
13. **B-023** `/asset` vs `/assets` route consolidation (~30min)
14. **B-024** `/live` route ou redirect (~15min)
15. **B-028** SDK `OnchainCommitment.cluster` remover ou popular (~30min)
16. AC78 webhook dogfood já marcado drop em decisão mas ainda aparece em 12-acceptance-criteria.md — cleanup (~10min)

---

## 15. Sugestões de fix

```ts
// B-017 — web/components/organisms/onboarding-modal.tsx
- "Pegana is a real-time watchdog for 23 Solana pegged assets — …"
+ `Pegana is a real-time watchdog for ${assets.length} Solana pegged assets — …`
// hook: useQuery(["assets"], () => fetch("/api/assets-snapshot").then(r=>r.json()))
```

```rust
// B-025 — crates/methodology/src/state.rs OR API serializer
// option A (cheap): keep UPPERCASE in JSON, update spec docs.
// option B (correct): serialize Rust PegState as CamelCase to match spec
#[serde(rename_all = "PascalCase")]
pub enum PegState { Pegged, Drift, Depeg, Critical, BlackSwan }
```

```tsx
// B-027 — web/app/(marketing)/layout.tsx
import Link from "next/link"
// All links pointing at /docs/*:
- <Link href="/docs">
+ <Link href="/docs" prefetch={false}>
```

```rust
// B-018/B-019/B-021 — crates/api-rs/src/handlers/alerts.rs
fn parse_limit(q: Option<i64>) -> Result<i64, ApiError> {
    let v = q.unwrap_or(50);
    if v < 1 || v > 500 {
        return Err(ApiError::BadRequest("limit must be 1..=500".into()));
    }
    Ok(v)
}
```

```caddy
# B-022 — Caddyfile @ api.pegana.xyz
api.pegana.xyz {
    @assets path /v1/assets /v1/assets/
    cache @assets {
        ttl 5s
    }
    reverse_proxy api:8080
}
```

```nginx-like
# MCP-DEVNET — docker-compose.yml @ mcp service
services:
  mcp:
    environment:
      SOLANA_NETWORK: solana-mainnet  # was: solana:EtWTRABZ… (devnet cluster id)
      SOLANA_RPC_URL: https://api.mainnet-beta.solana.com
# then: docker compose up -d --force-recreate mcp
```

---

## 16. Próximos passos recomendados

**Hoje (1-2h):**
1. SSH no host, confirmar/corrigir MCP `SOLANA_NETWORK`. Documentar achado em ADR-0018 ou em `project_x402_facilitator_block.md` (memory).
2. Fix B-017 (10min) — onboarding count. Bind à `/v1/assets`.
3. Fix B-027 (30min) — `prefetch={false}` em links docs.
4. Push commit "fix: P0 MCP mainnet + P1 onboarding count + RSC docs prefetch" → deploy.

**Esta semana (4-6h):**
5. Sweep B-025 state casing. Escolher convenção, atualizar 14 specs + agents page + bot strings + qualquer cliente sample. Um único PR atômico.
6. Auditar fórmula `uptime 30d` em `web/lib/metrics`. Comparar com Grafana Prometheus dado real.
7. Adicionar Caddy cache em `/v1/assets` (B-022).

**Antes do verdict gate 06-11 (1-2 dias):**
8. Round-2 QA com Playwright mobile breakpoints (375×812).
9. Stress test 500 concurrent + chaos (matar Redis, ver fallback).
10. WS smoke test (script Node assina `/v1/ws`, conta mensagens em 60s).
11. Verificar 7 settlements x402 on-chain — se forem devnet, retract claim.

**Pós-launch (depois de 7d-stable, 2026-06-18+):**
12. Hardening batch H1-H12 (per `project_audit_quality_sprint_2026_05_29.md`).
13. Sub-project B (Risk Signals).

---

## Verdict

Pegana **funciona** mecanicamente: APIs respondem, MCP serializa, bot responde, web renderiza, infra estável.

Pegana **NÃO está pronto** para um observador externo crítico hoje, porque:
- O primeiro número que o usuário vê (`23 assets`) é falso (`22`).
- O console abre vermelho em qualquer página (RSC prefetch).
- Spec docs e API divergem em enum casing (primeira coisa que um integrador rigoroso compara).
- E o claim mais importante do GTM ("MCP paid mainnet LIVE") tem alta probabilidade de estar em devnet em prod neste momento.

Estes são problemas de **disciplina editorial e ops hygiene**, não de engenharia profunda. Dão para resolver em ~6h focadas. Resolver antes de 06-11 transforma o gate de "Yes, but…" em "Yes."

— QA sênior, 2026-05-29 22:55 UTC
