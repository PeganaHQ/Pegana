# HANDOFF — Calibrar o MÁXIMO de betas + adicionar o novo token Hylo xBTC (2026-07-23)

> **Para a próxima sessão (pós-/clear).** Duas tarefas acopladas: (A) graduar o máximo HONESTO
> de assets `monitoring_only` (beta) → calibrado, e (B) adicionar o **xBTC** (Hylo acabou de
> lançar) ao universo. Ambas terminam numa **migration standalone** + `deploy.sh --migrate
> --config-only`. **NADA foi deployado.** Siga o workflow do projeto: 1:1, gate verde, commit por
> path, NUNCA merge/deploy (founder-only). Leia as memórias primeiro.

---

## 0. Estado do repo (ponto de partida)

- Branch **`landing/v2-port`**, ~**436 commits à frente de `origin/main`**, sincronizada, **gate
  verde**, **PR-ready** (`docs/V1-LAUNCH-PR.md`). **NADA mergeado/deployado.**
- V1 launch-prep está COMPLETO (7 rounds de convergência + honestidade on-chain ADR-0041 + cleanup
  + contagens corretas). Detalhe: `ROADMAP.md` seção "2026-07-20" + memória
  `project_v2_relaunch_execution_2026_07_18.md`.
- **Gate de validação** (rode antes de commitar): rust `cargo test --workspace` (43 suites) +
  clippy 0 + fmt + **`cargo run -q -p xtask -- backtest --check` = "no drift ✓"** · web `tsc` +
  796 vitest + eslint · bot `bun run typecheck` + testes + lint.
- Prod roda em `${PEGANA_DEPLOY_SERVER}` via `scripts/deploy.sh`. **Migration de metadata =
  `deploy.sh --migrate --config-only` (SEM rebuild, SEM recreate de engine).**

---

## 1. TAREFA A — Calibrar o MÁXIMO honesto (beta → calibrado)

**Plano-mãe (leia primeiro):** `docs/operations/2026-07-20-beta-promotion-retro-plan.md`.
**Critério (leia):** `docs/operations/monitoring-only-promotion-criteria.md` + ADR-0015 + ADR-0029.
**Template da migration:** `migrations/0060_promote_beta_assets_to_calibrated.sql` (flip de
metadata: `metadata - 'monitoring_only' - 'monitoring_since' - 'monitoring_reason'`, idempotente,
já rodou em prod — validado).

### Baseline ao vivo (verificado 2026-07-20 via `GET /v1/assets` + `/v1/calibration`)
- Prod (build antigo): **63 tracked · 20 calibrados · 43 beta** (42 lêem `health: ok`; 1 =`xSOL`
  `miscalibrated`, beta permanente por design).
- ⚠️ Prod = 63 (não os 72 do canon); os LSTs da mig-0064 **ainda não estão em prod** → entram num
  retro FUTURO após o V1 deployar + a janela própria deles. Este batch é tudo de mig-0053 (≥26 dias).

### Check de liquidez Birdeye JÁ FEITO (2026-07-20) — o resultado abaixo é o insumo pronto
Critério do gate passo-4 ("o engine consegue detectar um move?") = perna de mercado líquida, não
fonte-única. Rodei Birdeye `token_overview` nos 42 ok-betas. Floor = `$25k`
(`DEXSCREENER_MIN_LIQUIDITY_USD`, ADR-0026).

**🟢 DEEP (liq ≥ $25k) — 36 assets:** BNSOL · BulkSOL · CASH · CDCSOL · JLP · JSOL · LST · ONyc* ·
PSOL · PST · USD1 · USDG · USDu · USX · bonkSOL · bpSOL · cgntSOL · corvusSOL · definSOL · dynoSOL ·
dzSOL · edgeSOL · hSOL · haSOL · hyloSOL+* · iASOL · jagSOL · laineSOL · lanternSOL · mangoSOL ·
picoSOL · proSOL · raiSOL · rkuSOL · vSOL · xandSOL.

**🔴 THIN/HOLD (liq < $25k) — 6:** `RoXSOL` ($4.2k) · `STKESOL` ($22k — borderline) · `USD*`
($3.3k) · `eUSX` ($1.1k) · `sHYUSD`/eHYUSD ($6.9k) · `sharkSOL` ($143 dust). → ficam beta.

### ⚠️ EXCLUSÕES ADICIONAIS (liquidez OK mas NÃO promover — frozen-signal, ADR-0024)
`hyloSOL+` e `ONyc` passaram no floor de liquidez (marcados `*` acima) MAS o doc de critério os
exclui como **frozen-signal**: discount constante de fonte-única que o engine NÃO consegue
distinguir de um move real. **PENDÊNCIA que eu NÃO terminei:** confirmar no `assets.toml` a config
de `[market]`/`[intrinsic]` desses dois (e de qualquer LST novo) — se a perna de mercado é
single-source constante, HOLD; senão, promove. (O comando falhou por indisponibilidade temporária
do modelo — refazer.) `eHYUSD`(sHYUSD) = **HARD BLOCK** (fix da perna Jupiter primeiro).

### ➡️ Set de promoção PROVÁVEL = **~34** (36 deep − hyloSOL+ − ONyc), a confirmar com:
1. **Passos que faltam ANTES de finalizar o set:**
   - [ ] Terminar o check de config `[market]`/`[intrinsic]` no `assets.toml` pros 36 deep
     (achar qualquer fonte-única/constante além de hyloSOL+/ONyc).
   - [ ] **Retro SQL no prod (founder, SSH):** rodar `scripts/calibration-monitor.sql` (adaptado)
     pra confirmar os 2 checks que o endpoint NÃO cobre: **≥7 dias de dados completos** (0
     source_outage) + **0 transições false_positive/noisy** na janela. Eu devo PREPARAR esse SQL
     (emitir por-asset: p95, dias-cobertos, outages, ruído → veredito PROMOTE/HOLD).
2. **Escrever a migration `0069`** (espelho da 0060) com o set confirmado + tirar as anotações
   `# monitoring-only per ADR-0015 …` no `assets.toml` desses + escrever o relatório do retro
   (ADR-0015 exige justificativa por-asset).
3. **Validar:** só toca `assets.metadata` → **golden byte-exact NÃO afetado** (igual 0060).
   Confirmar que o badge beta cai em web/bot/webhook + o denominador `/v1/calibration` sobe.
4. **[founder] deploy:** `deploy.sh --migrate --config-only`.

**Resultado esperado: calibrados 20 → ~54 (34 + os 20 atuais).** Maior salto de credibilidade com
o menor esforço (uma migration, sem rebuild).

**Os holdouts frozen-signal** (hyloSOL+, ONyc, eHYUSD): destravam com o **depth-gate (Sub-B,
ADR-0034)** — que agora É viável porque temos a **Birdeye key** (ver §3). Isso pode virar uma
subtarefa: usar a Birdeye key como fonte de depth pra o gate, aí eles graduam com honestidade.

---

## 2. TAREFA B — Adicionar o novo token Hylo **xBTC**

Hylo acabou de lançar o **xBTC** (provavelmente o análogo leveraged/synth do `xSOL`, mas
BTC-referenciado — CONFIRMAR). É um asset NOVO no universo → não é uma promoção, é uma adição
completa.

**Pesquisa necessária (context7 + web + Solana docs MCP + a doc da Hylo https://docs.hylo.so):**
- [ ] **Mint address** do xBTC na mainnet + decimals.
- [ ] **Mecanismo/classe:** é `synth_lev` (como xSOL) referenciado a BTC? Qual o intrinsic
  (exchange state on-chain da Hylo?) e o BTC/USD numéraire (Pyth BTC/USD feed)?
- [ ] **Fonte de market price** (rota Jupiter? liquidez via Birdeye — usar a key).
- [ ] Se é leveraged/synth → provavelmente entra **`monitoring_only=true` (beta) por design** no
  começo (como o xSOL; bandas largas, zero histórico) — NÃO calibrar de cara.

**Implementação (padrão de adição de asset — espelhe uma entrada `synth_lev`/Hylo existente):**
- [ ] Entrada em `assets.toml` (symbol, mint, class, peg_target, `[intrinsic]`, `[market]`,
  thresholds, `active=true`, `metadata.monitoring_only=true`).
- [ ] Verificar se precisa de um **adapter/decoder** novo no indexer (`crates/indexer-rs/src/sources/`)
  ou se a fonte Hylo existente (hylo.rs) já cobre xBTC — CONFIRMAR lendo `hylo.rs`.
- [ ] Migration de INSERT do asset (espelhe `migrations/0053`/`0055`/`0064` — insert em `assets`
  com metadata).
- [ ] `cargo run -q -p xtask -- verify-assets` (confere mint on-chain) + **golden byte-exact**
  (adicionar asset novo NÃO deve mexer no hash dos recibos existentes — confirmar).
- [ ] Copy/docs: se aparecer em superfície pública, seguir a regra eHYUSD (símbolo canônico vs
  display) e NÃO inflar contagem (aponta pro `/v1/assets`).

**⚠️ Cuidado grande (lição desta campanha):** o xSOL e o sHYUSD são a classe de bug "frozen-signal
/ premium carve-out" — um leveraged/synth Hylo com perna Jupiter fina pode congelar PEGGED num
print garbage (foi o HARD BLOCK do sHYUSD). Então o xBTC provavelmente deve entrar **beta +
UNKNOWN-honesto** até ter perna de mercado confiável + janela de calibração. Não prometa calibrado.

---

## 3. Secrets / constraints (IMPORTANTE)

- 🔑 **Birdeye API key** — o founder forneceu uma key (limite **60 rpm total** entre todas as
  keys). Ela **NÃO está escrita em nenhum arquivo** (boa prática + cred-guard). **A próxima sessão
  precisa que o founder re-cole a key**, OU ela deve estar no `.env` do prod como
  `BIRDEYE_API_KEY`. **⚠️ Recomende ROTACIONAR essa key** — foi colada no chat (exposta no
  histórico). Uso: Birdeye `GET https://public-api.birdeye.so/defi/token_overview?address=<mint>`
  com headers `X-API-KEY`, `x-chain: solana`. Respeite 60 rpm (sleep ~1.1s entre chamadas).
- Adicionar `BIRDEYE_API_KEY=` (só o slot vazio) ao `.env.example` — pendência que eu NÃO fiz.
- **NUNCA** push pra `origin/main` (= deploy prod). Só `landing/v2-port`. Merge/deploy = founder.
- Commit por-path (nunca `git add -A`). Termine mensagens de commit com
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Não rode `next dev`/`next build` local (trava o PC). Valide com tsc+vitest.
- **NUNCA confie no retorno de um agente/workflow** — leia o `journal.jsonl` + o código 1:1. Esta
  campanha inteira, cada round adversarial quebrou o fix do round anterior; e o pior bug foi achado
  lendo código 1:1 enquanto o workflow dizia "0 confirmed". Ver `feedback_always_1to1_validate`.

---

## 4. Endpoints/comandos úteis (verificados)
- `curl -s https://api.pegana.xyz/v1/assets` → universo ao vivo (tem `monitoring_only`, `mint`, `class`).
- `curl -s https://api.pegana.xyz/v1/calibration` → saúde por-asset (`health: ok/miscalibrated`,
  `p95_bps`, `drift_bps`) — o gate ADR-0015 (ii) ao vivo.
- Birdeye liquidez: ver §3.
- `scripts/calibration-monitor.sql` — base do retro SQL (adaptar).

---

## 5. Ordem sugerida pra próxima sessão
1. Ler memórias + `docs/operations/2026-07-20-beta-promotion-retro-plan.md` + este handoff.
2. Pedir a Birdeye key ao founder (ou confirmar no prod `.env`).
3. **Tarefa B (xBTC)** primeiro se o founder priorizar o token novo — pesquisar (Hylo docs +
   context7) → assets.toml + migration + validar golden. OU **Tarefa A** primeiro (o retro SQL +
   mig 0069) se o foco for maximizar calibrados. Pergunte a ordem se ambíguo, mas o pedido foi
   "calibrar o MÁXIMO **e** incluir o xBTC" → faça os dois; podem ir na MESMA migration `0069` (flip
   dos ~34 + insert do xBTC) ou em duas (`0069` promoção, `0070` xBTC) — decida por coesão.
4. Preparar os artefatos (SQL do retro + migration + relatório), validar 1:1 + gate, commitar por
   path, pushar `landing/v2-port`. Deploy = founder.
5. Atualizar `ROADMAP.md` + memória ao terminar.
