# Análise completa — copy do dashboard: badge "monitoring", tooltips e glossário

**Data:** 2026-06-15 · **Método:** Playwright na produção live (www.pegana.xyz) + leitura do código + dados reais da API · **Contexto:** decisão de liberar os `monitoring_only` como "beta / em testes" e deixar o copy profissional (sem jargão de engenheiro).

---

## 0. Resumo

O dashboard vaza **jargão interno de engenharia** para o usuário final em 3 superfícies:
1. **Badge "monitoring"** + seu hover → mostra texto cru do banco ("Calibration v1 downgrade: p95 exceeded drift band… calibrated launch denominator" / "Phase-0 launch activation… 7-day retro") e data ISO crua ("2026-06-10").
2. **Glossário** (`lib/glossary.ts`) → "Premium" informal + 4 termos com jargão de infra ("lite-api quotes at 0.5 rps", "extra-api", "Hermes SSE stream", "decode the Exchange account") e **exemplos desatualizados** (cita "BRZ"/"BRL/USD" — o asset FX live é EURC/EUR).
3. **Tooltips inline** → recovery "the flips dimension is scored neutral", Pyth "(conf/price)", e a página `/status` expõe "lite-api round-robin" e "p95".

Tudo isso é corrigível **só no front-end** (web), sem migração nem deploy de backend — exceto se você quiser também limpar o texto cru no banco (opcional).

---

## 1. ⭐ Badge "monitoring" + hover (o que você apontou)

**Componente:** `web/components/molecules/monitoring-badge.tsx`
**Renderização atual:**
```ts
const label = since ? `monitoring since ${since}` : "monitoring";   // since = "2026-06-10" (ISO cru)
const body  = reason ?? "This asset is monitored, but not counted as calibrated yet.";
// tooltip = `${label}: ${body}`  → ex.: "monitoring since 2026-06-10: Calibration v1 downgrade: p95 exceeded drift band…"
// texto visível do badge = "monitoring"
```

**Onde aparece (3 lugares):**
- `components/organisms/asset-hero-v2.tsx:126` — cabeçalho da página de detalhe (ao lado de "INF")
- `components/organisms/asset-table.tsx:175` — tabela do screener (desktop)
- `components/organisms/mobile-asset-row.tsx:7` — linha mobile do screener

**Fonte do texto:** API `monitoring_reason` + `monitoring_since`, vindos de `assets.metadata` (migrações 0048/0049/0050). O componente **ecoa o texto cru do banco** — por isso o jargão vaza.

**Problemas concretos (confirmados no screenshot live do INF):**
| # | Problema | Exemplo live |
|---|---|---|
| 1 | Jargão de engenheiro no hover | "Calibration v1 downgrade: p95 exceeded drift band or structural anomaly; monitored but excluded from calibrated launch denominator." |
| 2 | "Phase-0" / "7-day retro" (você não quer que o usuário veja isso) | "Phase-0 launch activation with zero calibration history; provisional thresholds until the 7-day retro." |
| 3 | Data ISO crua | "monitoring since **2026-06-10**" (deveria ser "Jun 10, 2026") |
| 4 | Palavra "monitoring" não comunica nada ao usuário | badge `MONITORING` |

**Correção proposta (web-only):** o badge para de ecoar o `reason` cru e renderiza **copy profissional, fixo e consistente** + data formatada.
- Texto do badge: `monitoring` → **`beta`** (ou `em testes` — mas o site é EN-only, então `beta`).
- Hover: **"Beta — provisional calibration. We track this asset live, but its thresholds are still being tuned, so readings can be noisier than fully-calibrated assets."** + (opcional) "Tracking since Jun 10, 2026."
- O `monitoring_reason`/`monitoring_since` continuam na API para uso operacional (critérios de promoção), mas **não vazam mais** para o usuário.

> Isso também é exatamente o rótulo "em testes" da decisão de liberar os monitoring_only. Quando os alertas forem ligados (mudança no dispatcher/API), o badge "beta" já estará correto.

---

## 2. Os 13 textos `monitoring_reason` (todos jargão) — referência

Capturados da API live. Hoje **todos** aparecem no hover. Com a correção do §1, o usuário deixa de ver qualquer um deles (passa a ver o copy único de beta). Mantidos aqui como referência (e caso você queira limpar o banco também):

| Asset(s) | Texto cru atual (jargão) |
|---|---|
| mSOL, INF, bbSOL, hyloSOL, sHYUSD | "Calibration v1 downgrade: p95 exceeded drift band or structural anomaly; monitored but excluded from calibrated launch denominator." |
| dzSOL, vSOL, JupUSD, EURC, JLP | "Phase-0 launch activation with zero calibration history; provisional thresholds until the 7-day retro." |
| hyloSOL+ | "Frozen single-source signal: discount pinned to one distinct value over the window… cannot detect real stress." |
| xSOL | "Class C monitoring-only asset; no calibrated peer denominator." |
| ONyc | "Public RWA with a frozen market leg… cannot detect a real market move." |

**Datas (`monitoring_since`):** mSOL/INF/bbSOL/hyloSOL/xSOL/sHYUSD = 2026-06-10 · dzSOL/vSOL/JupUSD/EURC/JLP = 2026-06-11 · hyloSOL+/ONyc = 2026-06-14. (As datas estão corretas — o problema é o formato ISO cru, não o valor.)

---

## 3. ⭐ Tooltip "Premium" + glossário inteiro (`lib/glossary.ts`)

O `?` que você colou tem `term="premium"`, renderizado por `components/atoms/help-icon.tsx` (mostra `title` + `body` do glossário).

**"Premium" atual (`lib/glossary.ts:65-69`):**
> "Market price above intrinsic — the asset is **richer than fair value**, shown as a NEGATIVE spread. Usually transient; **arbitrage closes it quickly**."

Problemas: "richer than fair value" é informal; "arbitrage closes it quickly" é discutível para LSTs (o INF, por exemplo, sustenta um prêmio estrutural de demanda). **Proposta:** *"Premium — the market trades above an asset's intrinsic (fair) value, shown as a negative spread. Often a small demand premium; arbitrage tends to pull it back toward fair value."*

**Problemas mais graves no resto do glossário (jargão de infra vazando + exemplos errados):**

| Termo | Linha | Problema | Correção |
|---|---|---|---|
| `jupiter` | `glossary.ts:171` | "round-robin **lite-api quotes at 0.5 rps**" — detalhe de infra interno | "We read live quotes across the best on-chain route to get the realised market price." |
| `sanctum` | `:161` | "from Sanctum's **extra-api**" | "from Sanctum's public stake-pool data." |
| `pyth` | `:166` | "**Hermes SSE stream**… **BRL/USD**" — infra + exemplo errado | "Live price oracle for SOL/USD, FX crosses (e.g. EUR/USD), and delta-neutral references." |
| `hylo` | `:176` | "**decode the Exchange account** directly" | "We read Hylo's on-chain state to compute hyUSD's collateral ratio and xSOL's NAV." |
| `stable_fx` | `:149` | exemplo "**BRZ**" + "BRL/USD" — **não existe**; o asset FX live é **EURC** (EUR) | "…Pyth FX cross (e.g. EUR/USD). Example: EURC." |

(Os demais termos — intrinsic, market, spread, discount, bps, states, classes — estão bons.)

---

## 4. Outros tooltips inline (secundário)

| Local | Texto | Avaliação |
|---|---|---|
| `recovery-confidence.tsx:106` | "No alert history yet — **the flips dimension is scored neutral**, so this grade is provisional…" | "flips dimension" é jargão → "we don't have enough alert history yet, so this grade is provisional." |
| Pyth confidence (sidebar) | "Pyth price-oracle confidence interval **(conf/price)**." | "(conf/price)" é jargão → remover o parêntese. |
| `asset-preview-pane.tsx:259` | "24h dispersion of the spread — rising volatility precedes a depeg" | OK (aceitável). |
| `status/page.tsx:78` | "Market quote **(lite-api round-robin)**" | infra jargão na /status → "Market quote (best on-chain route)". |
| `status/page.tsx:323,514`, `calibration-banner-client.tsx:97` | "**p95** spread", "p95 {n}bps" | `/status` é página de transparência/ops — p95 é mais defensável ali, mas idealmente acompanhado de um `?` glossário. Secundário. |

---

## 5. Conexão com a decisão "liberar monitoring_only como beta"

Esta análise de copy é a **camada de apresentação** da decisão maior (liberar os 13 para alertar, rotulados "em testes"). As duas se encaixam:
- **Badge "monitoring" → "beta"** (este doc) = o rótulo "em testes" que você pediu.
- **Liberar o gate** (dispatcher/API/bot) = a mudança de comportamento (os 13 passam a disparar alerta) — mapeada no doc anterior `docs/2026-06-15-pegana-user-surface-audit.md` e na análise de gates.

Idealmente as duas vão juntas no deploy, para que "beta = alertas ligados, calibração provisória" seja verdade. Mas a correção de copy (§1-§4) é **web-only e pode ir primeiro** (texto seguro nos dois estados — "provisional calibration" é verdade com ou sem alertas ligados).

---

## 6. Plano de correção (web-first, baixo risco, reversível)

**Fase A — copy (web-only, imediato):**
1. `monitoring-badge.tsx` — badge "monitoring"→"beta"; hover = copy profissional fixo (ignora `reason` cru); formatar `since` ("Jun 10, 2026").
2. `lib/glossary.ts` — reescrever "premium" + limpar jargão de infra em jupiter/sanctum/pyth/hylo + corrigir exemplo FX (BRZ/BRL → EURC/EUR).
3. `recovery-confidence.tsx:106` + Pyth "(conf/price)" + `status/page.tsx:78` — remover jargão.
4. Testes: o glossário e o badge são testáveis; adicionar/atualizar testes de copy. (web vitest já roda — 269 testes verdes.)

**Fase B — comportamento (a decisão maior, separada):**
5. Liberar o gate `monitoring_only` no dispatcher + API + engine on-chain, com flag `beta` propagado para o alerta do bot + payload do webhook (mapeado na análise de gates).

**Fase C — opcional:**
6. Migração reescrevendo os 13 `monitoring_reason` no banco para texto profissional (para a API/MCP também ficarem limpos). Não é necessário se o web parar de ecoar o texto cru.

---

## 7. Decisões para você

- **Texto do badge:** `beta` (recomendado, EN-only) — confirma?
- **Data no hover:** formatar "Jun 10, 2026" (manter) **ou** remover totalmente? (recomendo manter formatada.)
- **Escopo agora:** só Fase A (copy, imediato) **ou** Fase A + B juntas (copy + liberar alertas)?
- **Fase C (limpar banco):** fazer agora ou deixar (web já resolve o que o usuário vê)?

*Análise feita com Playwright na produção live + leitura de código + dados reais da API. Screenshot do problema: `monitoring-tooltip-INF.png`. Nada foi alterado — aguardando seu OK no plano.*
