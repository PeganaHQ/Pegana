# Dashboard Deep Audit — mock vs shipped (2026-05-24)

> Method: rendered the approved mock (`mock-02-dashboard.html`) headless at 1440×900 + captured shipped `/dashboard` at same viewport + tested every interaction via Playwright (hover row, click filter, click toggle, click sort, click pip).
>
> Reference: `00-MOCK-reference.jpeg` (mock) vs `01-shipped-baseline.jpeg` + `02-shipped-fullpage.jpeg` + `03-hover-state.jpeg`.

## TL;DR

Dashboard tem **12 problemas reais vs mock**. Estrutura existe (componentes mountados, tests verdes) mas composição final tá longe do que aprovamos. Maior diferença: o **layout 3-colunas (Table | Preview Pane | Alerts)** nunca rendiriza — preview pane só aparece em hover e quebra o layout. Active strip mostra 3 cards em vez de 2. Filter row faltando metade dos chips. PRO/LITE toggle é puramente cosmético.

Severidade: 🔴 crítico · 🟠 importante · 🟡 polish

---

## 1. Top eyebrow incompleto

**Mock:** `● PEG HEALTH — LIVE · 23 ASSETS · CLICK A PIP TO JUMP · HOVER FOR DETAIL`

**Shipped:** `● PEG HEALTH — LIVE · 23 ASSETS`

Faltam 2 instruções de UX que ensinam o usuário a usar o strip. 🟠

---

## 2. Peg-strip ocupa o dobro do espaço

**Mock:** apenas a linha de bars (compacta, ~32px de altura total)

**Shipped:** bars + linha de **labels** abaixo (`INF JupSOL bSOL bbSOL dSOL hyloSOL hyloSOL+ jitoSOL mSOL PYUSD USDC USDT USDS hyUSD USDe xSOL ONyc USDY pbUSDC sHYUSD sUSD sUSDe syrupUSDC`) — fica ~60px de altura, empurra todo o resto pra baixo.

Decisão original do mock: labels só aparecem em hover do pip (tooltip). 🟠

---

## 3. Hero composition: 3 stacked rows em vez de 1 horizontal

**Mock:** uma única row horizontal ocupando ~88px:
```
[anchor 8]  [STATUS NOW / of 23 outside threshold / 24/05/2026...]  [editorial sentence rica]  [TRACKED ALERTS MEDIAN WIDEST]  [MODE PRO/LITE]
```

**Shipped:** três rows empilhadas que ocupam ~280px:
```
Row 1: [anchor 7]   [STATUS NOW / of 23 outside threshold / date]   [editorial flat]    ← (vazio à direita)
Row 2:                                                              [TRACKED ALERTS MEDIAN WIDEST]   ← (centralizado-ish)
Row 3:                                                              [MODE PRO/LITE]   ← (sozinho)
```

Razão: `flex items-end gap-12 flex-wrap` no DashboardOverview faz wrap quando a editorial sentence + stats não cabem em 1280px. 🔴

---

## 4. Editorial sentence flat vs rica

**Mock:** "Today, **xSOL** is critical at +11.21% (Hylo leverage repricing). **sUSD** depeg at +2.14%. Six more drifting; median spread 21 bps." (texto editorial em 3 partes, com `xSOL` e `sUSD` em iridescent gradient text — chama atenção pros assets críticos por nome)

**Shipped:** "7 of 23 are outside threshold." (plain text, sem destaque, sem contexto sobre quais assets)

O `editorial` callback no `dashboard-overview.tsx:33-39` tem 4 branches mas nenhuma é tão rica quanto o mock. 🔴

---

## 5. Active strip mostra 3 cards quando mock tem 2

**Mock:** xSOL +11.21% (CRITICAL) + sUSD +2.14% (DEPEG) — apenas os 2 verdadeiramente fora do peg

**Shipped:** INF -1.05% (DRIFT) + dSOL -35 bps (DRIFT) + hyloSOL -35 bps (DRIFT) — 3 cards, todos DRIFT, nenhum CRITICAL/DEPEG

Logic em `active-strip.tsx`: pega top-3 com state DRIFT/DEPEG/CRITICAL/BLACK_SWAN. Deveria priorizar por severidade (CRITICAL > DEPEG > DRIFT) e cap em 2. 🔴

---

## 6. Compare watchlist na linha errada

**Mock:** A row "COMPARE WATCHLIST [chips] · STACK ON ONE CHART →" aparece **dentro do hero block** (entre stats e a filter row) — coerência visual

**Shipped:** Compare watchlist na sua própria row vazia ABAIXO do active strip, ocupando 56px de espaço sozinho 🟡

---

## 7. Filter row faltando 50% dos chips

**Mock:**
```
[Search] · [ALL 23] [LST 14] [STABLE 6] [CDP 2] [YIELD 4] [CRITICAL 1] [DEPEG 1] [DRIFT 6] [A ONLY] · [EXPORT CSV] [JSON] · [TABLE | MOSAIC]
```
13 elementos.

**Shipped:**
```
[Search] · [ALL CLASSES ▾] · [ALL 23] [PEGGED 16] [DRIFT 6] [DEPEG 1] [CRITICAL 0] · [TABLE | MOSAIC]
```
8 elementos.

Missing:
- ❌ Per-class chips: LST 14 / STABLE 6 / CDP 2 / YIELD 4
- ❌ Safety chip: A ONLY (filtra por safety grade A)
- ❌ Action chips: EXPORT CSV / JSON
- ❌ Has unwanted: "ALL CLASSES" dropdown (redundant — chips would replace)

E o PEGGED chip existe shipped mas não no mock (mock só tem chips de OUT-OF-PEG states + ALL). 🔴

---

## 8. 3-coluna layout NÃO renderiza — preview pane só em hover

**Mock:** 3 columns side-by-side **always visible**:
```
[ Asset Table - 760px ]  [ Hover Preview · jitoSOL - 320px ]  [ Live Alerts - 280px ]
```
Preview pane mostra `jitoSOL` como **default** mesmo sem hover.

**Shipped:** 2 columns:
```
[ Asset Table - flex-1 ]  [ Live Alerts - fixed ]
```
Preview pane **não está no DOM** até hover. Confirmado via:
```js
document.querySelector('[data-testid="asset-preview-pane"]') // null
```

Quando hover em qualquer row, pane MONTA com `display: block` num slot DENTRO do flex container `xl:flex-row`. Isso causa **LAYOUT SHIFT** brutal — alerts column é empurrado pra fora do viewport, conteúdo da tabela perde 320px.

Visualizei no `03-hover-state.jpeg`: live alerts SUMIU completamente do viewport quando hover ativou. 🔴

---

## 9. Preview pane conteúdo: 5 elementos em vez de 13

**Mock — preview pane (sempre visível) mostra:**
1. Eyebrow "HOVER PREVIEW · JITOSOL"
2. Asset name `jitoSOL` (com pip pulsing)
3. State + safety badge `DRIFTING · A` (iridescent)
4. **Big spread number** `-28 bps` (48px)
5. Caption `72 BPS BELOW INTRINSIC · LAST 24H · 8 STATE FLIPS`
6. **Mini chart** with `DRIFT THRESHOLD` dashed line + spread curve
7. Intrinsic `108.23 sol` / Market `108.52 sol` (2-col stats)
8. Pegged 24h `19.5%` / Last update `12s ago` (2-col stats)
9. Section divider "THRESHOLD LADDER"
10. Ladder visualization with current marker position
11. State labels: `PEGGED ←—— DRIFT ——→ DEPEG ——→ CRITICAL`
12. Buttons row: `OPEN ASSET →` / `⊕ COMPARE` / `★ PIN`

**Shipped — preview pane (only on hover) shows:**
1. Eyebrow "Hover preview · sUSD"
2. Asset name `sUSD`
3. State badge `DEPEG`
4. Big spread number `+2.18%`
5. Asset description `Solayer USD`
6. Button `Open asset →` (single button)

Missing: caption, mini chart (slot é black box vazio), intrinsic/market split, pegged 24h, last update, threshold ladder, compare button, pin button. 60% do conteúdo. 🔴

---

## 10. Live alerts: 4 alerts em vez de 14

**Mock — visible alerts list (14 items):**
```
xSOL  CRIT  +11.2%   17h
USDe  CRIT  +2       19h
PYUSD CRIT  +3       20h
USDT  CRIT  +2       21h
USDC  CRIT           47h
─────────────────────────
INF   DEPEG +4       14h
sUSD  DEPEG +2       15h
─────────────────────────
dSOL  DRIFT +9       1m
mSOL  DRIFT +9       7m
hyloSOL DRIFT +4     15m
jitoSOL DRIFT +6     19m
pbUSDC DRIFT +4      18m
bSOL  DRIFT +4       36m
bbSOL +2             45m
```
Visualmente: ALERT TAG inside red/orange boxes (`[CRIT]` em red), spread number, age right-aligned. Cluster visual por severidade.

**Shipped — visible alerts (4 items only):**
```
xSOL CRITICAL ×7    34m
bSOL DRIFT  ×22     19m
JupSOL DRIFT ×16    1h
bbSOL DRIFT ×15     1h
```
Visualmente: dot pip + symbol + tag + count + age. Sparser.

Razão: alerts vêm de `useAlerts` hook que limita query. Mock tinha pré-populado com mock data densa pra mostrar o feel. Em produção com WS conectado, alerts vão fluir conforme o backend dispara. 🟠

---

## 11. PRO/LITE toggle é cosmético

**Mock:** Pro mode = full table denso + sparklines + preview pane + filters extensos. Lite mode = top-5 LSTs simplificado, sem preview pane, filters reduzidos.

**Shipped:** Click no Lite muda só o highlight visual do botão. Mesmo número de rows (6 com DRIFT filter), mesmo número de active strip cards (3), mesma peg strip (23 pips), mesma sidebar.

Confirmação via `evaluate` após click:
```js
{ rowsAfterLite: 6, activeStripCards: 3, pegStripPips: 23, liteVisible: true, proVisible: false }
```

Variável `mode` em `dashboard-overview.tsx:42` setada mas nunca consumida pra alterar render condicional. 🔴

---

## 12. Bottom-of-table caption ausente

**Mock:** sob o último row visible da tabela, em mono pequeno cinza: `+ 14 more rows · pegged majority hidden behind filter`

Convida o user a aplicar outro filter ou usar mosaic mode. 🟡

---

## O que FUNCIONA

✅ Peg-health strip renderiza 23 pips com bar height por state
✅ Click no DRIFT chip filtra (sebbene chip ativo não fica destacado)
✅ Sort by Spread reorder rows (Flip animation rodando)
✅ Hover em row monta preview pane (mas com layout shift)
✅ Click no Lite toggle muda visual (mas sem efeito real)
✅ 23 rows renderizam corretamente
✅ Sparkline por row (col 24h)
✅ Compact footer
✅ Live alerts sidebar tem recency-fade + freshest border (1 alert visible)

---

## Recovery plan para reverter pro mock

### Quick wins (~1.5h)

**A) Hero composition single-row** — Tarefa: refazer `DashboardOverview` JSX pra usar `grid-cols-[auto_1fr_auto_auto]` em vez de `flex-wrap`. Anchor + editorial + stats + MODE ficam todos em uma horizontal row.

**B) Active strip cap em 2 + priorize severity** — Em `active-strip.tsx`, mudar `.slice(0,3)` pra `.slice(0,2)` e sort por `STATE_RANK` (CRITICAL=0, DEPEG=1, DRIFT=2) antes do slice.

**C) Editorial sentence rich** — Reescrever o `editorial` callback em `dashboard-overview.tsx` pra incluir os 2 widest assets por name (com iridescent class).

**D) Filter row completar chips** — Em `dashboard-filters.tsx` adicionar: class chips (LST/STABLE/CDP/YIELD), A ONLY safety toggle, EXPORT CSV/JSON buttons. Remover dropdown "ALL CLASSES".

**E) Peg-strip remove labels row** — Em `peg-health-strip.tsx`, deletar o `<span>` com `s.symbol` dentro do button (deixar só o `bar`). Labels viram só tooltip.

### Maior (~2h)

**F) Preview pane sempre visível com default jitoSOL** — Mudar `<AssetPreviewPane>` pra renderizar SEMPRE (não condicional `if (!symbol) return null`). Quando `hoveredSymbol == null`, fallback pra `assets[0]?.symbol` ou um destaque pré-selecionado. Garantir slot reserva 320px no layout independent of hover.

**G) Preview pane content match mock** — Adicionar ao `AssetPreviewPane` os 7 elementos faltantes: caption "X bps below intrinsic · last 24h · N state flips", mini chart com DRIFT THRESHOLD line, intrinsic/market 2-col, pegged 24h / last update, threshold ladder bar + state labels, COMPARE + PIN buttons.

### Polish (~30min)

**H) Bottom-table caption** — Adicionar `<p>+ N more rows · ...</p>` quando filter está ativo e há rows hidden.

**I) Pip jump anchor visual feedback** — Quando click num pip, adicionar highlight no destination row por 1s.

**J) PRO/LITE actually toggles** — Wire mode state. Quando Lite, mostrar top-5 assets em mosaic mode, esconder preview pane.

---

## Próximo passo

Posso executar A-E (quick wins, ~1.5h) numa única PR — corrige 5 dos 12 problemas em sequência. Depois F-G em outra PR. Depois H-J de polish.

Ou tudo numa só. Diga qual prefere.
