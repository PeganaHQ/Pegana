# Pegana — Auditoria sênior das superfícies de usuário (TG Bot, SDK, MCP, API, Webhooks, Replay, Links/Licença)

**Data:** 2026-06-15 · **Escopo:** tudo que um usuário externo toca · **Método:** leitura linha-a-linha + 5 auditores paralelos + testes executados + probes na API live `api.pegana.xyz`

---

## 0. Sumário executivo — nota por superfície

| Superfície | Nota | Pronto p/ usuário externo? | Bloqueador principal |
|---|---|---|---|
| **Telegram Bot** | **A−** | Sim | Deixa assinar assets `monitoring_only` que nunca alertam (P2) |
| **API REST** | **A−** | Sim | `pt-BR` reescrito (P2); janela de replay não documentada p/ webhooks (P2) |
| **Webhooks** | **A−** | Sim | Sem janela anti-replay documentada para o receiver (P2) |
| **MCP server** | **B+** | Sim (free + x402 mainnet) | Link de repo 404 + "22 assets" desatualizado (=26) (P2) |
| **SDK** | **B− / D** | Só p/ "verificar receipt" | Cobre 4/35 endpoints, sem auth, não publicado (P1) |
| **pegana-replay (verificabilidade)** | **C−** | **NÃO pelo caminho documentado** | Installer entrega v0.2.0, nenhum release 0.3.0/0.4.0, crate não está no crates.io → `VERSION_MISMATCH` em todo alerta live (**P0**) |
| **Links/Licença pública** | 🔴 parcial | Quebrado em 3 canais live | crates.io + docs-site "License (MIT)" + Smithery apontam p/ repo **privado** 404 (P1) |

**Veredito geral:** o núcleo de engenharia é sólido e disciplinado para um projeto solo — a API, o bot e os webhooks estão production-ready. **As duas feridas reais não são de código, são de *distribuição e links públicos*:** (1) a ferramenta de verificação pública (a tese inteira do produto) não verifica nada pelo caminho que os docs mandam seguir, e (2) o link "MIT / GitHub" que você mesmo levantou aponta para o repo privado em pelo menos 3 lugares que um estranho realmente clica.

---

## 1. ⭐ A SUA PERGUNTA #1 — Alertas de admin: só o seu userid, ou todos?

**Resposta curta:** existem **três** caminhos de alerta totalmente separados. Resumo:

| Tipo de alerta | Quem recebe | Mecanismo | Outros usuários veem? |
|---|---|---|---|
| **Infra/operacional ("admin de verdade")** | **Só o grupo de ops** (`ALERTMANAGER_TELEGRAM_CHAT_ID`) | Prometheus → Alertmanager → **bot DEDICADO de ops** | **Nunca.** Isolado, sem porta no host. |
| **Depeg em modo dogfood** (`FEATURE_PUBLIC_ALERTS=false`) | **Só o seu chat** (`DOGFOOD_TELEGRAM_CHAT_ID`) | Dispatcher redireciona TODOS os alertas p/ 1 chat | Não — nem assinantes recebem nesse modo. |
| **Depeg em modo público** (`FEATURE_PUBLIC_ALERTS=true` — **estado atual em prod**) | **Cada assinante**, no chat dele, só dos assets que ele assinou | Dispatcher faz fan-out por `subscriptions` | Você **não** é privilegiado — só recebe o que você assinou. |

**Detalhe técnico verificado linha-a-linha:**

- **O bot (`bot-ts`, 1356 linhas) NÃO tem conceito de "admin".** Não há comando de admin, não há broadcast-para-todos, não há userid hardcoded. Procurei no arquivo inteiro: zero. O endpoint interno `/send` (`index.ts:1031`) recebe **um `chatId` por chamada** — quem decide o destinatário é o **dispatcher**, não o bot.
- **Alertas de infra/admin** (engine caiu, heartbeat, disco, etc.) saem por uma stack **completamente separada**: `ops/alertmanager/config.yml` → receivers `telegram-critical`/`telegram-warning` → `ALERTMANAGER_TELEGRAM_CHAT_ID` usando um **bot de ops dedicado** (`ALERTMANAGER_TELEGRAM_BOT_TOKEN`, *não* o `BOT_TOKEN` do @PeganaWatchBot). É interno (sem porta exposta). **Nenhum usuário do bot público jamais recebe isso.** ✅
- **Alertas de depeg em dogfood:** `dispatcher-rs/src/main.rs:342-358` — quando `FEATURE_PUBLIC_ALERTS=false`, **todo** alerta é redirecionado para um único alvo sintético: o `DOGFOOD_TELEGRAM_CHAT_ID`. Nesse modo, **só você recebe**, e assinantes reais não recebem nada.
- **Alertas de depeg em público (modo atual):** `main.rs:331` `match_subscriptions()` faz fan-out por usuário, cada um no seu chat. Confirmei na API live que `FEATURE_PUBLIC_ALERTS=true` em prod (o feed `/v1/alerts` retorna 16 linhas; ele é gated por essa flag). Então hoje os assinantes recebem os próprios alertas e **você não tem nada de especial** no fluxo de depeg.

**Conclusão:** ✅ Os alertas de **admin/infra** vão **só para o seu grupo de ops** — nenhum usuário comum vê. Já os alertas de **depeg** vão para cada assinante (modo público atual) ou só para você (modo dogfood). **Não existe** um mecanismo de "admin manda um aviso para todos os usuários do bot" — se você quiser isso (ex.: aviso de manutenção a todos os assinantes), **não está implementado**.

> ⚠️ **Cuidado operacional (P2):** a flag `FEATURE_PUBLIC_ALERTS` é lida **separadamente** pelo bot (controla só o banner "private beta" e o log de boot) e pelo dispatcher (controla o roteamento real). Se os dois serviços divergirem no `.env`, o bot pode mostrar "private beta" enquanto o dispatcher já está mandando público (ou vice-versa). Mantenha os dois iguais.

---

## 2. Telegram Bot — experiência do novo usuário (nota A−)

**Jornada do novo usuário (traçada linha-a-linha em `index.ts`):**

1. **`/start`** (`:434`) → foto de boas-vindas (`welcome.png`) com fallback p/ texto se o upload falhar → trata deep-link `sub_<asset>_<bps>` (1-clique assinar vindo do site) → mostra banner "private beta" se `!FEATURE_PUBLIC_ALERTS` → abre o **menu principal** inline (Status · Minhas subs · Assinar · Silenciar · Aprender · Config · Web · Ajuda). Primeira impressão é boa: o usuário vê o que o bot faz sem decorar comandos.
2. **Navegação** toda em-lugar via `editMessageText` (`menu:<secção>` callbacks) — não empilha mensagens. ✅
3. **Assinar:** picker tappável agrupado por classe (stables fiat → yield/RWA → CDP/DN → LSTs → synth), 3 botões por linha (legível no celular). Default 0.5%. Também aceita `/subscribe USDT 0.5` p/ power users.
4. **Comandos completos (18):** start, menu, help, subscribe, unsubscribe, list, status, threshold, alerts, mute, snooze, unmute, explain, define, history, digest, me, web — registrados no menu hamburger do Telegram (EN-only, ADR-0022).
5. **Silenciar:** mute por asset, snooze global (1h/4h/24h), unmute, todos com feedback inline.
6. **`/web`:** gera magic-link nonce via API (`/v1/auth/magic/mint` com `x-internal-secret`), cai p/ URL simples se a API falhar — o botão "Web" nunca aparece quebrado. ✅
7. **`/me`:** cartão de perfil (locale, alerts on/off, subs ativas/mutadas, alerts 7d, digest, data de entrada) + toggle de alertas inline.
8. **Digest diário:** agendador a cada 5min, por timezone do usuário, com guarda de 1h "last sent" (restart não duplica).

**O que está muito bem feito:**
- **Segurança do `/send`:** comparação de segredo em **tempo constante** (`timingSafeEqual` + checagem de tamanho, `:1044`) — fecha timing-attack no segredo interno que poderia forjar alertas a qualquer usuário.
- **Idempotência** (`:1073`): retry do dispatcher não manda o mesmo alerta 2×. First-write-wins.
- **Rate limit** 30 msg/usuário/60s, janela deslizante, 1 aviso por janela (não queima o budget do Telegram).
- **Resiliência:** `bot.catch` global, polling supervisor com backoff, lock de polling (só 1 instância faz long-poll, as outras mantêm `/send` online), shutdown gracioso (drena pool PG), `allowed_updates` enxuto.
- **Renderização do alerta (`helpers.ts`)** — **a superfície mais importante (o que o usuário recebe) é de alta qualidade:** trata sinal premium vs discount, assets CR-driven (hyUSD lidera com Collateral Ratio), reconciliação LST em espaço-SOL (senão os preços USD não fecham com o spread), confiança de oráculo (só quando degradada, nunca em CR-driven), label NAV p/ yield-bearing, recibo de evidência, retração (🛑) e evidence-ready (🔍) com headers distintos. Tudo HTML-escapado.

### Achados do bot

| Sev | Achado | Arquivo:linha | Correção |
|---|---|---|---|
| **P2** | **Usuário pode assinar asset `monitoring_only` que NUNCA vai alertá-lo.** `listAssets()` faz `FROM assets WHERE is_active` e **não filtra `monitoring_only`**. O bot referencia `monitoring_only` **zero vezes**. Então os 13 assets monitoring_only (mSOL, INF, bbSOL, hyloSOL, hyloSOL+, sHYUSD, xSOL, JupUSD, JLP, EURC, dzSOL, vSOL, ONyc) aparecem no picker, o usuário assina, vê na `/list`, define threshold — e o egress gate do dispatcher (`main.rs:315`) **suprime todo dispatch**. Ele nunca recebe alerta, nem em depeg real, e o bot não avisa. Para um produto "a gente te avisa", aceitar silenciosamente uma assinatura que não pode alertar é um furo de confiança. | `bot-ts/src/db.ts:85-90`; `bot-ts/src/index.ts:302-334,517-531` | Marcar monitoring_only no picker (badge "📡 monitoring") e/ou avisar na confirmação de subscribe: "este asset está em monitoramento — alertas públicos desativados". A web já faz esse badge; o bot ficou para trás. |
| **P3** | `/status` sem arg roda N+1 (1 query `latestDiscount` por asset em `Promise.all`) — 26 queries por comando. OK em 26 assets, mas a secção de menu fatia em 50 e o comando não fatia — inconsistente. | `index.ts:788-812` vs `:342-352` | Uma query agregada de "último discount por asset" resolve ambos. |
| **P3** | Bloqueio de usuário (`is_blocked`) só por escrita direta no DB — não há comando de moderação. | `index.ts:170-176` | OK para hoje; um `/admin block <id>` gated por id viria a calhar quando escalar. |

**Testes do bot:** `bun test` → **70 pass · 7 skip · 0 fail** (183 asserts). ✅

---

## 3. SDK (nota B− como helper de receipt / D como "SDK do Pegana")

Dois SDKs paralelos sob `sdk/`: `@pegana/sdk-ts` (TS) e `pegana-sdk` (Python), ambos `0.1.0`, ambos **não publicados** (`private:true` / `Do Not Upload`).

- **Superfície:** 4 funções, só o fluxo público de verificação de receipt — `getAudit(id)`, `getAuditIndex()`, `getOnchain(id)`, `verifyAlert(id, sha)`. Todos os shapes batem com a API live (validado campo a campo).
- **Testes:** TS `bun test` **6/6** ✅ · Python **6/6** ✅. Build TS limpo (typecheck + bundle + `npm pack`).
- **Bug histórico corrigido + travado:** `verifyAlert` lia um `receipt_sha256` flat que nunca existiu → hoje lê `evidence.receipt_sha256` e tem regressão-lock nas duas linguagens.

### Achados do SDK

| Sev | Achado | Correção |
|---|---|---|
| **P1** | **Cobre 4 de 35 endpoints (~11%) e expõe ZERO do que um integrador realmente quer:** sem `/v1/assets`, sem peg-state, sem history, sem feed de alerts, e **sem auth** → toda a superfície `/v1/me/*` (subs + gestão de webhooks) é inalcançável. É um stub de "verificar hash", não um SDK. | Cobrir assets/state/history + alerts; adicionar modelo de auth p/ `/v1/me/*`. |
| **P2** | Nenhum `LICENSE` viaja no tarball (`npm pack` confirma 7 arquivos, sem LICENSE) apesar de declarar MIT. | Adicionar `sdk/{typescript,python}/LICENSE` ao pacote. |
| **P3** | Sem retry/`Retry-After` contra uma API com rate-limit (e `/v1/audit` tem 10/min). `getAuditIndex` em loop bate 429 e lança `Error` genérico. | Honrar `Retry-After` + classe `PeganaApiError {status, body}`. |
| **P3** | Python só síncrono (httpx importado mas `AsyncClient` não usado); retorna `dict[str,Any]` sem tipos. | Roadmap v0.2.0 já reconhece. |

**Link:** os pacotes apontam para `pegana-replay` (**público, 200**) — ✅ corretos. O SDK é a única superfície que acertou o link.

---

## 4. MCP server (nota B+)

Deploy real em `mcp.pegana.xyz` (verificado healthy, 8 tools, 26 assets em cache). Transporte Streamable-HTTP stateless sobre Hono/Bun. Conexão por URL (sem signup p/ tools free; x402 mainnet p/ paid).

**8 tools:** `ping`, `get_assets`, `get_asset_state`, `get_methodology`, `verify_alert` (free) · `ping_paid` ($0.001), `get_asset_history` ($0.001), `subscribe_peg_events` ($0.0005) (x402, USDC mainnet).

- **x402 verificado contra o desafio 402 live:** rede `solana mainnet`, payTo `EAfKRjg…jnw`, USDC `EPjFW…Dt1v`, facilitator Coinbase CDP. **Boot falha-rápido** se mainnet sem creds CDP (ADR-0018). **Nenhum bypass de paywall encontrado** — paid tools só registram via wrapper de pagamento. ✅
- **Testes:** `bun run test` **40 pass · 3 skip** · typecheck/build/lint limpos.

### Achados do MCP

| Sev | Achado | Correção |
|---|---|---|
| **P1** | `get_asset_history` (pago) aceita buckets `5m/15m/1h` que a referência REST rejeita (HTTP 400). Resultado numérico está certo (Postgres `time_bucket` interpreta o intervalo), mas o comentário "Mirrors assets.rs" é falso e as duas superfícies divergem num contrato pago. | Alinhar a API p/ aceitar os 4 buckets, ou remover o comentário + teste afirmando o set MCP-only. |
| **P2** | **"22 active assets" hardcoded em README, descrições de tools, `transport.ts:73`, `smithery.yaml`** — live serve **26**. Agente lê a descrição como verdade e erra a cardinalidade. | Trocar por "(ver `get_assets` p/ a lista viva)". |
| **P2** | Contrato stale→UNKNOWN enganoso: em cache >300s retorna `_meta.state:UNKNOWN` mas `content[0].text` ainda traz o último estado real (ex.: `PEGGED`). Sinais contraditórios. | Sobrescrever o `state` no texto p/ UNKNOWN no caminho stale, ou reescrever a descrição. |
| **P3** | Cursor de `subscribe_peg_events` trunca p/ segundos → possível duplicata na borda (at-least-once, sem perda). | Cursor composto `(ts,id)`. |
| **P1 (link)** | `package.json` `repository`/`bugs`, README L9, `smithery.yaml` → `github.com/lrafasouza/pegana` (**404 privado**). Todo usuário que clica no metadata npm/Smithery cai em 404. | → `pegana-replay` ou remover (mcp-ts não está no repo público; apontar p/ pegana.xyz/developers). |

---

## 5. API REST + Webhooks (nota A−)

Live healthy (26 assets, methodology 0.4.0 no registro, `FEATURE_PUBLIC_ALERTS=true`). Rate limit 300/min por-IP (+10/min em `/v1/audit.csv`). Auth = JWT HS256 do Telegram-Login.

**O que está excelente (verificado live):**
- **Contrato "JSON em todo lugar"** é real: 404/400/401/405/422/429 todos `application/json` com shape consistente. Provei live com matriz de erros.
- **Auth fail-fast:** verificação HMAC em tempo constante, JWT com `jti` revogável (tabela `web_sessions`), magic-link com nonce CSPRNG 256-bit, TTL 15min, claim atômico race-free. Boot recusa secret <32 bytes.
- **Gate `FEATURE_PUBLIC_ALERTS`** esvazia corretamente `/v1/audit` index, `.csv`, `/v1/alerts`, e zera `stats.alerts_24h` — mantendo `/v1/audit/{id}` público (ungated by design). Validação roda **antes** do gate (não vaza conteúdo).
- **Egress gate monitoring_only** em profundidade: read-time em 4 endpoints + dispatch-time. Confirmei live: `/v1/alerts` retorna 16 linhas, **zero de asset monitoring_only**. O cursor avança sobre linhas puladas (página toda-monitoring não trunca o stream).
- **SQL:** 100% param-bound; a única interpolação é um literal de tempo de compilação (`"a.symbol"`/`"a.mint"`). Sem SQLi.
- **Webhooks:** Ed25519 sobre `<ts>.<body>`, headers `x-pegana-signature/timestamp/event-id/delivery-id/attempt`, rotação dual-key, pubkeys em `/v1/meta/webhook-keys`, IPs em `/v1/meta/webhook-ips`. Retry `5s·30s·5min·30min·2h` (6 tentativas), SSRF re-validado com DNS a **cada** envio, dead-letter + replay, semáforo de 50 permits. Retraction + evidence-reconcile são **delivery-keyed** (só quem recebeu o original 2xx) com `FOR UPDATE SKIP LOCKED` + recovery de in-flight no boot.

### Achados da API/Webhooks

| Sev | Achado | Arquivo:linha | Correção |
|---|---|---|---|
| **P2** | **`pt-BR` ressuscitado.** `auth.rs` insere `locale 'pt-BR'` no signup web, reabrindo o bug que a **migração 0043** fechou (default→`en` + backfill). Cosmético (renderer ignora locale, ADR-0022) mas é código stale reabrindo bug fechado. | `crates/api-rs/src/routes/auth.rs:64,296` | Remover o `locale` explícito dos INSERTs (deixar o default `en`). |
| **P2** | **Sem janela anti-replay documentada para webhooks.** A assinatura inclui timestamp ("anti-replay anchor") mas nada no verificador publicado checa frescor — um delivery assinado capturado replaya p/ sempre contra um receiver que só checa assinatura. É dever do receiver, mas isso nunca é dito onde importa. | `crates/common/src/webhook_sign.rs` | Documentar max-age recomendado (ex.: rejeitar `|now-ts|>5min`) e embarcar no verificador-exemplo. |
| **P3** | `RateLimit-*` headers ausentes no 2xx (só `Retry-After` no 429) → cliente não consegue se auto-regular. | `rate_limit.rs` | Adicionar `RateLimit-Limit/-Remaining/-Reset`. |
| **P3** | OpenAPI `info.description` diz "21 active assets" (live=26) e enumera assets em prosa. | `openapi.rs:73` | Contagem dinâmica ou parar de enumerar. |

**Testes:** as crates DB-backed (api/dispatcher/engine/indexer) precisam da stack Docker (que está **down** localmente). Validei essas via **leitura + probes na API live** (o agente fez a matriz de erros real). As crates puras rodaram localmente (ver §8). Para rodar os testes DB-backed: `docker compose -f docker-compose.local.yml up -d` e `PEGANA_E2E_STACK=1 cargo test --workspace`.

---

## 6. ⭐ pegana-replay + verificabilidade (nota C− — onde está o P0)

Esta é a tese central do produto ("verificabilidade-como-liquidação": qualquer um re-deriva o veredito a partir do bundle publicado). **O núcleo criptográfico é honesto e funciona — mas o produto *entregue* falha o único teste que importa.**

**O que está certo:**
- A CLI `pegana-replay` (`crates/pegana-replay-cli`) é determinística: no-floats (`rust_decimal`), JSON canônico RFC-8785, receipts content-addressed, cross-check on-chain via SPL-Memo. Reproduzi um hash de receipt de produção **byte-a-byte** de um build limpo.
- **A matemática da metodologia é 100% pública** (`crates/methodology` está no repo público) — não há furo "a matemática só existe no privado".
- Testes `cargo test -p pegana-replay-cli` → **2/2** ✅.

**O P0 — o caminho público documentado não verifica nada:**

Caminho real de um estranho seguindo os docs:
1. README → `curl …/pegana-replay-installer.sh | sh` → instala binário **v0.2.0** (installer tem `VERSION="${PEGANA_VERSION:-v0.2.0}"` hardcoded).
2. `pegana-replay --alert-id <qualquer alerta live>` → todo alerta live é 0.3.0 → **`VERSION_MISMATCH`, exit 3**.
3. Segue a dica `cargo install pegana-replay-cli --version 0.3.0` → **crate não existe no crates.io** (404). Beco sem saída.
4. O **único** caminho que funciona é o **não-documentado**: `git clone` do repo público (que por acaso está em 0.3.0 source) + `cargo build` → verifiquei que dá **PASS exit 0**.

Ou seja: um estranho determinado que **ignora** o README consegue verificar; um normal que **segue** o README **não consegue verificar nenhum alerta live**. Para um trust-layer, isso é P0, não cosmético.

**Observações de versão (importante, com nuance honesta):**
- **A CLI re-HASHEIA, não re-EXECUTA a metodologia.** Importa só as funções de hash, não `compute_discount`/`transition_decide`. Verifica *integridade do bundle* (inputs+output não foram alterados), não que o `final_state` é a saída correta da matemática sobre aqueles inputs. O README diz "reapplies the methodology" — impreciso (reaplica o *hash*). **P2 de narrativa.**
- **Repo público `pegana-replay` está stale:** último sync 2026-06-04 (11 dias), source em 0.3.0, `METHODOLOGY.md` carimbado **0.2.0**, último GitHub Release `v0.2.0`. Nenhum release 0.3.0 nem 0.4.0 foi cortado.
- **Reconciliação 0.4.0 vs receipts 0.3.0 — esclarecido por mim:** `/v1/methodology/current` diz **0.4.0** (registrado hoje 21:57Z). **Todos** os receipts live estão **0.3.0** — MAS o receipt mais novo é de **10:55Z**, ~11h **antes** do registro do 0.4.0. Como o engine só emite receipt em **transição de estado** e **não houve transição desde o deploy**, é **impossível confirmar pelo ledger** se o binário do engine já é 0.4.0. Isto **não** confirma o que o agente sugeriu ("engine não foi deployado") nem confirma o contrário. **Ação:** confirme o deploy do engine por SSH/health; e no momento em que a próxima transição carimbar um receipt 0.4.0, o público vai precisar de um verificador 0.4.0 — **que não existe como release**.

### Plano de correção do replay (em ordem)

1. **P0:** cortar um GitHub Release do verificador para a versão que o engine REALMENTE emite, e fazer o installer default apontar p/ ela (idealmente `installer` consulta `/v1/methodology/current` e instala a tag casada). Nunca avançar `/v1/methodology/current` à frente do que o engine carimba.
2. **P1:** publicar `pegana-replay-cli` no crates.io **ou** trocar a dica de `VERSION_MISMATCH` (`main.rs:113`) p/ apontar ao GitHub Release certo (a dica `cargo install` atual é um beco sem saída).
3. **P1:** rodar o sync do repo público (parado desde 06-04) e cortar mirror/release 0.4.0; atualizar `METHODOLOGY.md` (carimbado 0.2.0).
4. **P1:** corrigir o drift `Cargo.toml` version (0.3.0) ↔ `methodology_version()` embutido (0.4.0) — `--version` reporta 0.3.0 mas a identidade de verify é 0.4.0.
5. **P1:** adicionar teste de fixture/golden (bundle real → PASS) + teste cross-version (exit 3 é produzido **e recuperável**). Hoje os testes passam justamente porque não enxergam essa falha de produção.
6. **P2:** verificar `methodology_git_sha` contra o SHA do próprio build (PASS hoje = "algum build 0.3.0", não "este código publicado"); ou fazer a CLI **re-derivar** `final_state` e corrigir o README.

---

## 7. ⭐ A SUA PERGUNTA — Link MIT / repo privado

**Fato confirmado:** `github.com/lrafasouza/pegana` = **privado (404 anônimo)**. `github.com/lrafasouza/pegana-replay` = **público (200)**. O sufixo `-replay` é a diferença, e ele importa.

**O que você quis dizer com "o MIT aponta pro lrafasouza/pegana privado" — encontrado exatamente:** a declaração de licença que carrega um link de `repository` aponta p/ o repo privado em 3 lugares LIVE:

1. 🔴 **docs-site footer "License (MIT)"** (`docs-site/docs.json:82`) → `…/pegana/blob/main/LICENSE` → **404 para o público**. É o match mais literal da sua queixa: o link MIT está visível em pegana.xyz/docs e morto.
2. 🔴 **introduction.mdx** (`:89`): *"MIT licensed. All code in github.com/lrafasouza/pegana"* — afirma open-source e linka p/ repo que o leitor não abre.
3. 🔴 **crates.io** — `pegana-methodology` (`Cargo.toml:7`) e `pegana-replay-cli` (`Cargo.toml:12`) têm `license="MIT"` ao lado de `repository=…/pegana`. Quando publicados (e são, via mirror), o crates.io renderiza botão "Repository" → **404**. (`common-verify` já acertou com `-replay`.)

**Outros links públicos quebrados (P1):**
- docs.json nav/footer/social "GitHub" (`:47,74,193`) → 404.
- Smithery `repository` do MCP (`smithery.yaml:21`) → 404.
- Guias de docs com "view source / git clone" (mcp.mdx, telegram-bot.mdx, webhooks*.mdx, methodology/overview.mdx→engine-rs) → 404, **e pior**: mesmo trocando p/ `-replay`, esses caminhos (`mcp-ts/`, `bot-ts/`, `crates/dispatcher-rs/`, `crates/engine-rs/`) **não existem no repo público** — são privados. Então um find-replace ingênuo continua 404.
- `README.md:78` `git clone …/pegana.git` (só falha p/ não-colaborador), `scripts/install.sh:13 REPO="lrafasouza/pegana"`.

**Atenuantes:** `mcp-ts/package.json` e `sdk/typescript/package.json` são `private:true`; `sdk/python` é `Do Not Upload` → npm/PyPI **não publicam** hoje, então esses links privados são latentes, não live. A exposição live real é **crates.io** (2 crates) + **Smithery** + **docs-site (Mintlify)**. **A web (`web/`) está 100% limpa** — todo link usa `-replay` (o bug histórico de changelog 404 já foi corrigido).

**Decisão sua (enquadra tudo):**
- **(A) Manter o monorepo privado e reescrever todo link público p/ `pegana-replay`** (recomendado; ~10 arquivos, mecânico — MAS os links de source/clone p/ caminhos privados precisam ser **removidos/inlined**, não renomeados). 
- **(B) Tornar `lrafasouza/pegana` público** (corrige tudo de uma vez, mas expõe engine/dispatcher/infra/webhook-signing).
  
O design de repo-split (`repo-split-2026-05-29.md`) já aponta p/ (A); estes são os vazamentos residuais.

---

## 8. Resultados de testes (executados nesta auditoria)

| Suite | Resultado | Observação |
|---|---|---|
| Rust `pegana-methodology` | **53 pass / 0 fail** | lógica pura |
| Rust `pegana-common` | **23 pass / 0 fail** | |
| Rust `pegana-common-verify` | **3 pass / 0 fail** | carve-out do verificador |
| Rust `pegana-replay-cli` | **2 pass / 0 fail** | ⚠️ tautológicos — não pegam o break de produção (ver §6) |
| Bot `bun test` | **70 pass / 7 skip / 0 fail** | 183 asserts |
| Web `vitest` | **269 pass (46 files)** | |
| MCP `bun test` | **40 pass / 3 skip** | skips = x402 devnet + DB (precisam de chave/DATABASE_URL) |
| SDK TS `bun test` | **6 pass** | |
| SDK Python | **6 pass** | |
| **Rust DB-backed (api/dispatcher/engine/indexer)** | **NÃO RODADO** | Docker down local → sem DATABASE_URL/redis. Validado via leitura + probes na API live. Rodar com a stack: `docker compose -f docker-compose.local.yml up -d && PEGANA_E2E_STACK=1 cargo test --workspace`. |

**Total executado: 475 testes verdes, 0 falha.** A lacuna honesta: a camada DB-backed do Rust e os testes e2e full-stack não foram executados localmente (infra Docker indisponível) — foram cobertos por revisão de código + probes na produção live.

---

## 9. Lista priorizada de correções

**P0 (tese do produto):**
1. Corrigir o caminho de verificação pública (release casado com a versão que o engine emite + installer apontando p/ ela). §6.

**P1 (links públicos + confiança):**
2. crates.io: `repository` → `-replay` em `methodology` + `pegana-replay-cli`. §7
3. docs-site: trocar `docs.json` (License/GitHub/social) p/ `-replay`; reescrever links de source p/ caminhos privados. §7
4. Smithery + mcp-ts metadata → `-replay` ou pegana.xyz. §4/§7
5. Sync + release 0.4.0 do repo público; corrigir drift de versão da CLI. §6
6. Bot: sinalizar/avisar assets `monitoring_only` no picker. §2
7. Publicar SDK de verdade ou parar de anunciar `npm install @pegana/sdk-ts`. §3

**P2 (polimento de produção):**
8. API: remover write `pt-BR` (reabre migração 0043). §5
9. Webhooks: documentar janela anti-replay + embarcar no verificador-exemplo. §5
10. MCP: corrigir "22 assets"→dinâmico, contrato stale→UNKNOWN, divergência de buckets. §4
11. SDK: incluir LICENSE no tarball; retry/`Retry-After`. §3

**Operacional:**
12. Manter `FEATURE_PUBLIC_ALERTS` sincronizado entre bot e dispatcher. §1
13. Confirmar deploy 0.4.0 do engine por SSH/health (não confirmável por receipt até a próxima transição). §6

---

*Relatório gerado por auditoria sênior — leitura linha-a-linha de bot-ts (2612 linhas), helpers/db, dispatcher gating, alertmanager; 5 auditores paralelos sobre SDK/MCP/API/Webhooks/replay/links; 475 testes executados; probes na API live api.pegana.xyz.*
