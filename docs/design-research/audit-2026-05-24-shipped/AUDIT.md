# Pegana — Mock vs Shipped Audit (Completo)
> Date: 2026-05-24
> Method: Playwright capture de 16 páginas desktop (1440×900) + 4 mobile (390×844) em `localhost:3000` com main HEAD `e735cd2`, comparado contra mocks aprovados.

## TL;DR

A gente shipou estrutura, **não shipou fidelity**. Componentes existem, testes passam, mas a composição final tem 18 problemas visíveis distribuídos em 3 buckets:

| Bucket | Severidade | Páginas afetadas |
|---|---|---|
| **Componentes legacy + novos renderizando JUNTOS** (duplicação) | 🔴 quebra visual | dashboard, dashboard-mobile |
| **GSAP setting opacity:0 e nunca recuperando** | 🔴 conteúdo invisível | landing, dashboard, asset (safety A), developers (code blocks), status (histogram bars), events (heatmap) |
| **Componentes lookups errados / data missing** | 🟠 cosmético | landing universe grid, marquee |

**Severidade legend:** 🔴 quebra visual · 🟠 fidelity baixa · 🟡 polish · ✅ próximo do mock

---

## 1. LANDING (`/`)

| Aspecto | Mock | Shipped | Severidade |
|---|---|---|---|
| Hero h1 + iridescent "before it catches you." | ✅ | ✅ renderiza | ✅ |
| Anchor "8" + underline iridescent | 128-160px com contador | ✅ "8" com underline | ✅ |
| Live ticker card | Rotacionando assets | ✅ INF -1.04% visível, pip pulsing | ✅ |
| Stats strip (23/95/0.7s/99.97%) | 4 colunas right-align | ✅ alinhado | ✅ |
| **Marquee 2-rows** | 1 row primary (28s) + 1 row reverse (56s) GSAP | 🔴 **2 cópias estáticas das mesmas fontes**, transform inline e GSAP xPercent conflitando | 🔴 |
| **HowItComputes formula** | `spread = 1 − market / intrinsic` a 56-64px centerpiece | 🔴 **INVISÍVEL** — headline aparece, formula+sources+ladder somem (~1500px de buraco preto) | 🔴 |
| **Universe grid 23 cards** | 6 colunas, todos os 23 visíveis | 🔴 **Só 12 cards mostrando layout quebrado**: xSOL/sUSD pair, hyloSOL+ órfão, ONyc/USDY/pbUSDC/sHYUSD row, sUSDe/syrupUSDC órfãos — falta INF/JupSOL/dSOL/bSOL/bbSOL/mSOL/USDT/USDS/PYUSD/hyUSD/USDe | 🔴 |
| **Get-pinged Telegram bubble** | Bubble com mensagem typed-in | 🔴 **Bubble VAZIO** (só "Pegana Watchdog · @PeganaBot · 1h ago" header, conteúdo invisível) | 🔴 |
| Wordmark PEGANA | 248px bottom | ✅ | ✅ |
| Footer full 5-col | ✅ | ✅ | ✅ |

---

## 2. DASHBOARD (`/dashboard`)

| Aspecto | Mock | Shipped | Severidade |
|---|---|---|---|
| Peg-health strip top | 23 pips full-bleed, alturas variáveis | ✅ renderiza com labels | ✅ |
| Hero anchor "7" | 128px + iridescent underline + stats à direita | ✅ "7" + underline. Stats DESLOCADAS pra meio da viewport, não right-aligned | 🟠 |
| Editorial sentence | "Today, **xSOL** is critical at +11.2% (Hylo leverage repricing). **sUSD** depeg at +2.16%..." com iridescent highlight | 🟠 **"7 of 23 are outside threshold"** texto simples, sem nomes destacados | 🟠 |
| **PRO MODE · ON · LITE toggle** | Top-right do hero | 🔴 **AUSENTE** | 🔴 |
| **Active strip** | 2 mini-charts xSOL CRITICAL + sUSD DEPEG | 🔴 3 cards renderizados (INF, dSOL, hyloSOL) com **sparklines vazios** + duplica `● ACTIVE - 2 xSOL +7.02% sUSD +2.17%` texto (legacy CriticalCallout) | 🔴 |
| **Compare watchlist** | 1 sticky shelf | 🔴 **DUPLICADO**: texto `COMPARE WATCHLIST jitoSOL mSOL bSOL hyUSD +1 more · STACK ON ONE CHART →` (CompareCta legacy) E ABAIXO chips `[jitoSOL ×][mSOL ×][bSOL ×][hyUSD ×] · STACK ON ONE CHART →` (CompareShelf novo) | 🔴 |
| Faceted filter chips | ALL 23 / LST 14 / STABLE 6 / CDP 2 / YIELD 4 / CRITICAL 1 / DEPEG 1 / DRIFT 6 / A ONLY | 🟠 Search à esquerda mal posicionado, chips renderizam | 🟠 |
| Table com sparklines | Densa, sortable | ✅ funciona | ✅ |
| **Hover preview pane** | Slide-in entre tabela e alerts (xl:block) | 🔴 **NÃO RENDERIZA** — invisível no 1440. Razão provável: hoveredSymbol nunca seta porque AssetTable onRowHover nunca dispara | 🔴 |
| Live alerts sidebar | Recency-fade + fresh border | ✅ funciona | ✅ |
| **"1 Issue" toast bottom-left** | — | 🟠 React error notification renderizando na UI | 🟠 |
| Footer compact | ✅ | ✅ | ✅ |

**Mobile (390):** mosaic mode default ativa ✅, 23 cards visíveis em 2-col ✅. MAS continua com Active duplicado e CompareCta + CompareShelf duplicados.

---

## 3. ASSET DETAIL (`/asset/[symbol]`)

Capturei 5 variantes: jitoSOL, hyUSD, xSOL, USDC, bSOL. Padrão consistente em todas:

| Aspecto | Mock | Shipped | Severidade |
|---|---|---|---|
| Hero spread number | -28 bps/-29 bps/+6.21% em 88-128px | ✅ Renderiza correto | ✅ |
| Pip ring | 16px com glow iridescent | ✅ pip pulsing | ✅ |
| Iridescent underline no spread | 2px gradient | ✅ visível | ✅ |
| Threshold ladder | Marker animado 10%→final | ✅ marker no PEGGED/DRIFT/DEPEG/CRITICAL bar | ✅ |
| TL;DR + state info | Linha explicativa | ✅ texto correto | ✅ |
| Chart big | Recharts/lightweight-charts spread chart | ✅ funciona (canvas-based) | ✅ |
| 2-col "How X is priced" | Intrinsic + Market | ✅ funciona | ✅ |
| 30-day strip cells | PEGGED green / DRIFT orange / DEPEG red | ✅ cells coloridas | ✅ |
| Activity timeline | Per-row sparkline thumb + fresh-row iridescent border | ✅ funciona em jitoSOL (15+ rows com mini-sparklines) | ✅ |
| **Safety grade BIG LETTER "A"** | 200px scale-in com back.out + iridescent underline | 🔴 **LETRA INVISÍVEL** — só vejo o underline iridescente flutuando + os scores PEG/LIQUIDITY/MECHANISM. A letra A/B/C nunca renderiza (mesmo bug do GSAP set opacity:0 nunca recuperando) | 🔴 |
| Identity row 4-up | Class/Decimals/Peg target/Last updated | ✅ funciona | ✅ |
| Mint + copy/solscan | ✅ | ✅ | ✅ |
| Take it further 4-up CTA | Compare/Trade/Verify/Alerts | ✅ funciona | ✅ |

**Mobile (390):** stacking funciona, mas Safety A invisível persiste.

---

## 4. COMPARE (`/compare`)

| Aspecto | Mock | Shipped | Severidade |
|---|---|---|---|
| Empty state faint preview overlay | Major LSTs renderizando atrás de prompt + iridescent CTA | ✅ funciona perfeitamente — chart visível em ~30% opacity + "Pick a preset or add assets to begin." + "Try Major LSTs →" iridescent CTA | ✅ |
| Filled state após selecionar | Chart prominente + save-as-watchlist | A testar (precisa selecionar assets) | — |
| Footer compact | ✅ | ✅ | ✅ |

---

## 5. METHODOLOGY (`/methodology`)

| Aspecto | Mock | Shipped | Severidade |
|---|---|---|---|
| Hero "Two numbers, one truth." | iridescent em "one truth" | ✅ | ✅ |
| Pipeline diagram (Sources → Engine → Spread+State → Alert) | 4 nodes + 3 arrows com stagger entry | ✅ todos os 4 nodes renderizam com conteúdo, último (Alert) com border iridescente | ✅ |
| Sticky TOC (5 anchors) | lg:sticky com active highlight scroll-linked | ✅ visível: (01) INTRINSIC VALUE / (02) MARKET VALUE / (05) THE SPREAD / (04) HONESTY ABOUT LIMITS / (05) OPEN | ✅ |
| 5 sections | intrinsic / market / spread / honesty / open | ✅ todas presentes com dl/dt/dd structure | ✅ |
| Footer default | ✅ | ✅ | ✅ |

**Status: methodology é a melhor página do shipped.** Próxima do mock 95%.

---

## 6. STATUS (`/status`)

| Aspecto | Mock | Shipped | Severidade |
|---|---|---|---|
| Hero "All systems operational." | + HEALTHY pip + last snapshot meta | ✅ funciona | ✅ |
| Data sources table | Live (WS), Sanctum, Jupiter, Pyth, Hylo com sparklines de uptime | ✅ todos visíveis + sparkline + LIVE pip + freshness | ✅ |
| **By state stacked bar** | Proportional bar (15 PEGGED + 6 DRIFT + 1 DEPEG + 1 CRITICAL) | ✅ **funciona perfeitamente** — 16 PEGGED verde + 5 DRIFT bronze + 2 DEPEG + 1 CRITICAL vermelho | ✅ |
| By state counters | 16/5/2/0 abaixo do bar | ✅ | ✅ |
| **Alert activity histogram (24h bars)** | 24 bars scaleY rise stagger | 🔴 **bars INVISÍVEIS** — só vejo o título "Alert activity" + descrição + eixo "00H 06H 12H 18H NOW" mas barras não rendem | 🔴 |
| Incidents section | "No recorded incidents" | ✅ | ✅ |
| **"1 Issue" toast bottom-left** | — | 🟠 mesmo error toast do dashboard | 🟠 |
| Footer default | ✅ | ✅ | ✅ |

---

## 7. EVENTS (`/events`)

| Aspecto | Mock | Shipped | Severidade |
|---|---|---|---|
| Hero "Every depeg, replayable." | ✅ | ✅ | ✅ |
| **GitHub-style heatmap calendar 52×7** | 52 weeks × 7 days, color intensity por count | 🔴 **HEATMAP QUEBRADO** — só vejo `MON / WED / FRI` row labels + 3 células vermelhas em volta de "10 / 22" no canto direito. Os 364 cells deveriam preencher 60-95% da largura | 🔴 |
| Less/More legend | iridescent intensity scale | ✅ aparece no canto direito | ✅ |
| Filter chips (All/LSTs/Stables/Synthetic) | ✅ | ✅ | ✅ |
| Event rows com sparkline | Per-row 4-pt sparkline + state pill | ✅ funciona — 50+ event rows com sparkline thumb por linha | ✅ |
| Footer default | ✅ | ✅ | ✅ |

---

## 8. EMBED (`/embed`)

| Aspecto | Mock | Shipped | Severidade |
|---|---|---|---|
| Hero "Put a peg status on your site." | ✅ | ✅ | ✅ |
| **Specimen strip 4-up** | bSOL dark / jitoSOL drift / USDC light / xSOL critical | ✅ **funciona** — 4 badges renderizam com sparklines | ✅ |
| Asset/Theme/Sparkline form | ✅ | ✅ | ✅ |
| Preview iframe | bSOL com -31 bps | ✅ | ✅ |
| HTML snippet + Markdown + React/Next.js | Code blocks | ✅ visíveis | ✅ |
| Why embed it + Parameters | ✅ | ✅ | ✅ |
| Footer default | ✅ | ✅ | ✅ |

---

## 9. DEVELOPERS (`/developers`)

| Aspecto | Mock | Shipped | Severidade |
|---|---|---|---|
| Hero "REST. WebSocket. Open." | ✅ | ✅ | ✅ |
| REST endpoints table | 9 endpoints com GET + path + desc | ✅ todos visíveis | ✅ |
| **WebSocket code block** | `// connect / const ws = ...` snippet com syntax highlight | 🔴 **CODE BLOCK INVISÍVEL** — só título "WebSocket" + descrição renderizam, snippet some completamente | 🔴 |
| Webhooks SOON | Card com info | ✅ | ✅ |
| Embed widget | iframe snippet | ✅ | ✅ |
| **Examples (04)** | 4 one-liners curl + wscat | 🔴 **CODE BLOCK INVISÍVEL** — só título + descrição | 🔴 |
| Resources pills | ✅ | ✅ | ✅ |
| Footer default | ✅ | ✅ | ✅ |

---

## 10. LEARN (`/learn`)

| Aspecto | Mock | Shipped | Severidade |
|---|---|---|---|
| Hero "Case studies." | ✅ | ✅ | ✅ |
| **4-up grid + per-card chart preview** | USDC SVB + UST + mSOL + Upcoming placeholder | ✅ **funciona perfeitamente** — 4 cards com depeg-shape SVG preview | ✅ |
| Card meta (date · asset · drop %) | ✅ | ✅ | ✅ |
| READ CASE STUDY → CTAs | ✅ | ✅ | ✅ |
| Footer default | ✅ | ✅ | ✅ |

---

## 11. ABOUT (`/about`)

| Aspecto | Mock | Shipped | Severidade |
|---|---|---|---|
| Hero "A peg watchdog you can read." | ✅ | ✅ | ✅ |
| 2-col layout | esquerda copy + meta, direita widget | ✅ funciona | ✅ |
| **Working on right now widget** | 3 changelog entries com tag chips + pulsing green dot | ✅ **funciona perfeitamente** — 3 entries (FEATURE/FIX/FEATURE) com datas, descrições, full changelog link | ✅ |
| Meta strip (Author/Built with/Status/Hosted/License/Funding) | ✅ | ✅ | ✅ |
| Reach out pills | ✅ | ✅ | ✅ |
| Footer default | ✅ | ✅ | ✅ |

**Status: about é outra página próxima do mock 95%.**

---

## 12. CHANGELOG (`/changelog`)

| Aspecto | Mock | Shipped | Severidade |
|---|---|---|---|
| Hero "What changed." | ✅ | ✅ | ✅ |
| Filter chips (All/Feature/Fix/Internal) | ✅ | ✅ | ✅ |
| RSS link | ↗ RSS | ✅ visível right-aligned | ✅ |
| Entries com tag pills | ✅ | ✅ 5 entries renderizam com datas + FEATURE/FIX/INTERNAL chips | ✅ |
| Footer default | ✅ | ✅ | ✅ |

---

## 13. PROBLEMAS ESTRUTURAIS

### 13.1 Padrão consistente: GSAP `gsap.set(...{opacity:0})` que nunca recupera

**Onde aparece:**
- Landing: HowItComputes formula centerpiece + Telegram bubble
- Dashboard: Active strip sparklines vazios + hover preview pane
- Asset: Safety grade big letter "A"
- Status: Alert histogram bars
- Developers: Code blocks (WebSocket + Examples)
- Events: Heatmap cells

**Causa raiz provável:** o pattern `gsap.set(el, {opacity: 0}); /* later */ gsap.to(el, {opacity: 1, scrollTrigger: ... })` está rodando o `set` mas o `to` com ScrollTrigger só fira quando o trigger está REGISTRADO. Se o `await getScrollTrigger()` falha silenciosamente OU o `await getGsap()` racea com o mount, o `set` aplica e o `to` nunca chega.

**Fix:** mudar o pattern pra `gsap.fromTo(el, {opacity:0}, {opacity:1, ...})` que registra ambos states atomicamente, OU adicionar fallback CSS `opacity: 1` no estilo padrão e usar GSAP só pra animar de 0→1 (não confiar no set inicial).

### 13.2 Componentes legacy não removidos do dashboard

`<CriticalCallout />` e `<CompareCta />` ainda são renderizados em `web/app/dashboard/page.tsx` ao lado dos novos `<ActiveStrip />` e `<CompareShelf />`. O subagent que mountou os novos foi instruído a ser additive (preservar wiring), e a remoção dos legacy nunca aconteceu.

**Fix:** deletar imports + JSX de CriticalCallout e CompareCta de `app/dashboard/page.tsx`. Verificar se ainda há outros consumers; se não, deletar os files.

### 13.3 Universe grid não mostra 23 cards no desktop

Em `universe-grid.tsx`, a flag `MOBILE_PREVIEW=6` esconde cards 7-23 via `className={filter === "all" && i >= MOBILE_PREVIEW ? "hidden sm:block" : undefined}`. Em theory `sm:block` deveria mostrar todos no desktop. Mas o screenshot mostra apenas 12 cards no 1440.

**Fix:** investigar por que `sm:block` não está promovendo todos os cards. Pode ser combinação CSS grid + hidden que estoura o template.

### 13.4 Marquee dupla render

Os 2 tracks (primary + reverse) renderizam fontes duplicadas mas as transforms inline + GSAP xPercent estão conflitando. O resultado é 2 rows estáticas mostrando o mesmo conteúdo.

**Fix:** remover o `style={{ transform: "translateX(-25%)" }}` inline do trackB, deixar GSAP single source-of-truth de transform.

### 13.5 Hover preview pane no dashboard

`<AssetPreviewPane>` tem `hidden xl:block` então em viewports <1280 não aparece. Mas em 1440 deveria. Possível: o `<AssetTable onRowHover>` nunca dispara o callback porque o evento mouseenter não está montado, OU o flex wrapper está colapsando o pane.

**Fix:** inspecionar DOM em 1440 com hover real, verificar se `[data-testid="asset-preview-pane"]` está no DOM mas display:none, ou se o hoveredSymbol fica null.

### 13.6 React error → "1 Issue" toast

Console reportou 1 erro em `/dashboard` e `/status`. Provavelmente hydration mismatch.

**Fix:** ler `.playwright-mcp/console-*.log` ou ver `web-dev-audit.log` pra identificar exact error.

---

## 14. PROPOSTA DE RECOVERY (4 fases)

### Fase A — Kill duplicates (rápido, alto impacto) — ~45 min
Branch: `fix/dashboard-kill-duplicates`
- Remove `<CriticalCallout>` + `<CompareCta>` imports e JSX de `app/dashboard/page.tsx`
- Audit outros consumers, deletar files se órfãos
- Capturar screenshot + diff
- 1 PR, ~3 commits

### Fase B — Fix opacity:0 stuck (críticos invisíveis) — ~2h
Branch: `fix/gsap-opacity-zero-stuck`
- Refactor patterns:
  - `HowItComputes` formula bloco
  - `LiveAlertBubble` Telegram content
  - `SafetyGrade` big letter
  - `StatusAlertHistogram` bars
  - `EventsHeatmap` cells
  - Developers code blocks (verificar)
- Mudança: `gsap.set(opacity:0)` + `gsap.to(opacity:1, scrollTrigger)` → `gsap.fromTo` atômico OR CSS default opacity:1 com GSAP só animando in
- Adicionar regression test que verifica computed opacity > 0.9 após mount em cada elemento
- 1 PR, ~6 commits

### Fase C — Fix layout broken (universe + marquee + preview pane) — ~1.5h
Branch: `fix/landing-universe-marquee + fix/dashboard-preview-pane`
- Universe grid: investigar `MOBILE_PREVIEW` + `hidden sm:block` no desktop
- Marquee: remover translateX inline conflict
- Hover preview pane: garantir render + onRowHover wire
- Resolver "1 Issue" React error
- 1-2 PRs

### Fase D — Base.org polish (~3-4h)
Branch: `feat/base-org-polish`
- Refinar page-load choreography
- Mouse-tracked spotlight committed (não só primeiro paint)
- Cursor states + CTA hover micro-feedback
- Considerar serif para methodology

---

## 15. PRÓXIMO PASSO

**Recomendação:** começar pela Fase A agora — corrige 4 duplicações visíveis no dashboard em 45 min e dá um sinal claro de progresso. Depois B (2h) resolve mais 6 invisible-content bugs. Depois C (1.5h) ajusta layout. D é cherry-on-top.

**Total recovery:** ~7-9h de trabalho focado distribuído em 3-4 PRs sequenciais.

Posso começar pela Fase A?
