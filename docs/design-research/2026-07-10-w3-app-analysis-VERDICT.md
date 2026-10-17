# W3 (app) — análise completa e veredito: rebuild vs aprimorar

> 2026-07-10. Fluxo de validação: 10 agentes (4 inventário → 3 pesquisa → advogado-rebuild
> vs advogado-incremental + killer de recomendações genéricas), síntese e julgamento final
> Fable. ~931k tokens, 289 tool calls, tudo read-only sobre a worktree `landing/v2-port`
> @ `d7f914c`. Complementa e revisa o MAPA (`2026-07-03-v5-full-rebrand-MAP.md` §6 W3/W4).

## Veredito

**Nem rebuild do app do zero, nem reskin: rebuild da camada de renderização sobre a
espinha de dados intocada** — strangler-fig, uma tela por vez, com os módulos puros de
`lib/asset/*` como fronteira dura que as telas novas IMPORTAM e nunca reimplementam.

Os dois advogados adversariais convergiram no mesmo plano por caminhos opostos — sinal
forte de que o veredito é robusto:

1. **A engenharia por baixo é recente, boa e batalha-testada.** Data layer (SWR + WS com
   watchdog de heartbeat), módulos puros (`freshness.ts`, `worst-sort.ts`, `policy.ts`,
   `format.ts`), a11y (0 violações axe nos 2 viewports), segurança (CSP isolado do
   Telegram-login, guard de open-redirect). Refazer isso do zero = semanas re-conquistando
   12 invariantes de confiança já provados em produção (lista no fim), com risco real de
   regressão e **zero ganho visível ao usuário**.
2. **A apresentação é 100% da marca velha e o salto de coerência é barato.** ~90-95% da
   superfície visual do app repinta com UMA edição de CSS: todo o app roteia cor por
   `--color-*` custom properties, inclusive o chart (`tv-chart/theme.ts` lê
   `getComputedStyle` em runtime — verificado que `DEFAULTS` é só fallback SSR). Os 8
   primitivos shadcn são 100% token-driven, zero hex.
3. **O "MUITO foda" mora em 3 telas + chrome, e essas SIM ganham rebuild de verdade**:
   screener, dashboard e asset-detail (a flagship), mais o chrome de app denso que o kit
   V5 não tem (nav-v2 é pill flutuante de marketing, o oposto de um topbar de produto).

## Decisões de stack (validadas com evidência, jul/2026)

| Proposta | Veredito | Por quê |
|---|---|---|
| **Redux (Toolkit)** | ❌ morto | Zero estado cliente cross-page (todo filtro/sort é `useState` local de página; os 4 Contexts existentes — theme/glossary/live-WS/auth — já são idiomáticos). RTK tocaria 30+ arquivos para centralizar estado que não existe, e o maior risco é reescrever o merge WS/REST que sustenta o invariante H1/H9. Nenhuma melhoria visível ao usuário. |
| **TanStack Query v5** | ❌ não agora | O único bug real achado (4 pollers de 30s duplicados em `/v1/alerts` — 7 call sites com limits 1/10/15/60/60/500/500 — e fetches de `/history` com shapes diferentes) é problema de **normalização de chave**, não de biblioteca: SWR conserta igual em ~1h. SWR não é abandonware: 2.4.2 saiu em meados de 2026, Vercel mantém, 4kb vs 13kb. Migrar = risco concreto por ganho abstrato. |
| **Zustand** | ❌ | Não há estado que o justifique. Reavaliar só se W3 criar filtro global cross-page real. |
| **shadcn/ui** | ✅ manter seletivo | Já configurado (`radix-nova`, `radix-ui ^1.4.3` unificado, 8 primitivos em `ui/`, bridge de tokens correto em `globals.css:246-264`). Regra: shadcn é gerador de COMPORTAMENTO acessível (focus trap, portal, roving nav) para o chrome; **nunca** fonte de identidade visual nem da camada de dados (table/chart/gauge ficam bespoke). |
| shadcn: **Tabs** | ✅ adotar | 3 implementações de tab hand-rolled duplicadas hoje (`asset-tabs`, `agent-tabs`, `product-tabs-v2`). Sweet spot exato do shadcn. |
| shadcn: **Sonner** (toast) | ✅ adotar quando a 1ª necessidade real chegar (W3/W4) | Zero toast no app hoje; feedback de webhook create/test é string em state local. Lacuna real, não especulativa. Usar `sonner` (o `toast` antigo é legacy nos docs 2026). |
| shadcn: data-table + TanStack Table | ❌ | 63 linhas nunca chega no payoff (virtualização paga em centenas/milhares). O sort NÃO é genérico: `compareWorstFirst` codifica stale-last-sempre + band-proximity — um `sortingFn` genérico não remove código nenhum. |
| shadcn: command (cmdk) | ❌ | A palette existente já reimplementa deliberadamente sobre `Dialog` (comentário no arquivo cita a lei de marca). Trocar por cmdk re-derivaria o mesmo comportamento. |
| shadcn: combobox, chart wrapper | ❌ | Sem caso de uso; recharts toca 1 arquivo (backtest) e o wrapper shadcn mira Recharts v3 (repo está em v2). |
| **lightweight-charts** | ✅ fica | Todos os charts de produção rodam nele; crosshair/candle que recharts não faz. |
| Virtualização, density toggle | ❌ | 63 linhas; toggle é polish genérico sem payoff de risco/estado. |

⚠️ **Nunca rodar `shadcn init` de novo neste repo** — Base UI virou default do CLI em
jul/2026; `components.json` pinado em `radix-nova` mantém `shadcn add` resolvendo Radix,
mas um re-init resetaria. Updates dos 8 `ui/` só com diff arquivo-a-arquivo (carregam
overrides de marca documentados, ex. header comment do `dialog.tsx`).

## Plano W3 revisado (confirma o MAPA, com upgrades e correções)

Processo por onda, inalterado: estudo → artifact HTML (Rafael julga no celular) → port
com dados reais → tsc+vitest → push branch preview → QA Playwright (desktop + mobile +
reduced-motion + axe nos 2 viewports). Sonnet implementa, Fable desenha/revisa. Nada de
push para origin/main.

### W3a — Fundação (o "80% de uma vez")
- **Tokens V5 no root** e deletar paleta velha: canvas `#000→#0a0a0b`, panels, hairlines
  translúcidas, 5 cores de estado (manter variantes AA-text para depeg/critical — v2.css
  não tem e o app PRECISA), gradiente 5-stop `--v2-iri`, **radius `0px → pill 100px
  interativo / 14-22px containers** (conflito DESIGN.md vs globals.css resolvido aqui),
  fontes Switzer + Geist Mono no root (`app/fonts/v2-fonts.ts` já tem os assets).
- **Matar light mode** (decisão já tomada; dual-theme dobra o custo de cada organismo).
- **`stateMeta`/`StatePillV2` canônico** (base: `v2/shared.tsx:118-191`, a melhor prior
  art) com `{label, badgeClass, textClass, spreadTextClass, dotColor, glowColor, washVar}`
  substituindo os ~20 mapas `PEGGED:` duplicados (29 arquivos têm mapas; 20 carregam cor).
  Preservar as decisões finas do `state-class.ts`: spread PEGGED = neutro, nunca verde.
- **Sweep manual dos renderers fora do CSS** (retokenizar NÃO alcança): OG images Satori
  (`asset/[symbol]/opengraph-image.tsx` com paleta velha hardcoded), rotas de embed (já
  drifted: `PEGGED:#3fa776`, um TERCEIRO verde que não bate com nada), `mouse-spotlight.tsx`
  (stops rgba do gradiente laranja velho), `tv-chart/theme.ts` DEFAULTS, `use-tick-flash.ts`.
- **Chrome de app V5 novo** (não existe no kit): topbar denso edge-to-edge, tab bar mobile,
  reskin da command palette e banners. Decisão de design incluída: aposentar
  `dashed-corner-marks` (afford. de instrumentação terminal, viola a lei anti-CLI).
- **Micro-fix SWR** (1h, zero risco): normalizar a chave de `useAlerts` (matar os 4
  pollers duplicados), unificar `useHistory`/`useHistory30d`, `<SWRConfig>` no root.
- shadcn: manter `--primary`/`--ring` monocromáticos (gradiente NUNCA em slot default —
  racionamento "4 momentos" sobrevive), estados como tokens `@theme inline` próprios.

### W3b — Screener + Dashboard (rebuild de apresentação)
- `/assets` e `/dashboard` refeitos na linguagem V5 (idiom `ListRowsV2` + `StatStripV2`;
  o board do hero-v2 é o proto-screener de referência), estrutura 3-panes pode evoluir.
- **Um hook canônico de filter/search/sort/clock** substituindo os 3 clusters `useState`
  independentes (dashboard/screener/events).
- Upgrade S: **sparkline com linha de threshold** (linha tracejada no nível de depeg do
  próprio asset dentro do sparkline da linha — `thresholdsFor` já é computado no
  worst-sort; "caindo E perto da linha" vs "caindo mas longe" num relance).
- **Regra dura de aceitação**: nenhuma tela computa staleness/severity — `effectiveState`
  e `compareWorstFirst` importados de `lib/asset/*`, um call site por superfície. (O
  codebase já duplicou o freshness-gate uma vez em feature work normal; o rebuild é a
  chance de convergir, não de duplicar de novo.)

### W3c — Flagship + chart analítico
- `/asset/[symbol]` (a tela onde "MUITO foda" se ganha) + **chart analítico V5**
  (eixos/tooltip/reference-bands — `AssetChartCanvas` é ilustrativo, não serve) +
  `/compare` + OG images dinâmicas.
- Upgrades (com o chart já aberto, custo marginal baixo): **timeline→chart scrub**
  (clicar um DEPEG na timeline reposiciona o chart naquele instante — hoje são dois
  blocos mortos desconectados; primitivos já provados no `compare-chart.tsx`) e
  **cmd-k verbs** (o `Item` union já tem `kind` discriminante; adicionar "add to
  watchlist / open in compare / copy alert id").
- **Contratos nomeados como teste, não vibes**: 404-vs-503 (`status !== 404`), redirect
  B-023 `/assets/[symbol]→/asset/`, params de URL (`?sort&dir`, `?s=`, `?tab&range&mode`),
  copy honesta do verifier ("tamper-evident, não re-derivação" — finding HIGH UX aberto,
  NÃO fortalecer o claim), axe nos 2 viewports (adicionar `/compare`, `/account`,
  `/asset/[symbol]` à suíte — hoje estão fora).

### W4 — Forms & account (inalterado)
Linguagem de form inteira a inventar (input/select/radio-card/slider/switch/erros) +
`account/*` + `auth/magic` (hoje é a superfície menos investida do app, card shadcn cru).

### Backlog pós-W3 (demand-gated, NÃO escopo do rebrand)
- **Incident overlay t-aligned** ("compare com o cascade de out/2025", série re-ancorada
  em t=0 no onset): a única feature que nenhum concorrente pode ter (receipts byte-exact)
  — mas espera um design partner pedir. Grafana-cargo-cult se construído agora.
- Drag-to-select brush (power-chrome; demanda zero), blast-radius/correlação cross-asset
  (M/L, especulativo).

## Kill list (auto-desafio — removido por genérico/injustificável)

Redux · TanStack Query · Zustand · TanStack Table/data-table · cmdk · combobox · chart
wrapper shadcn · troca/consolidação de chart libs · virtualização (63 linhas!) · density
toggle · **rebuild total do zero** (IA do app é sã; re-conquista de invariantes por
preferência estética) · **reskin-only** (repintaria as proporções Bloomberg-CLI que a
própria lei de marca rejeita — `feedback_v2_break_from_brandmd` aplicado ao app) ·
drag-brush agora · incident overlay agora · skeletons em massa · páginas novas (parked).

## Os 12 crown jewels (o que um rebuild NÃO pode perder — file:line)

1. H1/H9 freshness-gate: `lib/asset/freshness.ts:64-74` (+`STALE_AFTER_MS:14`) — snapshot
   velho degrada a UNKNOWN em linhas E contagens/headlines.
2. Frozen-WS-shadows-REST: `dashboard/page.tsx:105-137` — WS override só com `connected`.
3. Verifier + disclaimer honesto: `lib/verify-receipt.ts` (JCS RFC 8785 + SHA-256) e a
   copy exata de `static-receipt-verifier.tsx:56`.
4. Worst-first + band-proximity: `lib/asset/worst-sort.ts:21-28`, `lib/asset/band.ts:13-20`.
5. `reconcileBps()` declared-vs-computed + `MAX_PLAUSIBLE_ABS_DISCOUNT`: `lib/api/format.ts:52-97`.
6. `PER_ASSET_THRESHOLDS` + hysteresis espelhando o engine: `lib/alerts/policy.ts:33-95`.
7. `SustainedBadge` (tempo-em-estado): `components/molecules/sustained-badge.tsx:45-88`.
8. Magic-link: `sanitizeNext` anti-open-redirect + hard navigation: `auth/magic/page.tsx:31-39,78`.
9. Telegram iframe: CSP isolado + allowlist de origin + sanitização por whitelist:
   `app/embed/telegram-login/route.ts:79-154`.
10. Backend-down vs empty-filter: `!!error && !data` em dashboard:94, assets:290, events:158.
11. Trio a11y: `LiveStateAnnouncer`, sort announcer (`assets:299-306`), `StatePip.announce`.
12. Supressão dSOL/BRZ: `isDeprecated()/isLowLiquidity()` (`lib/api/format.ts:186-198`) —
    alcançável por URL, excluído de toda agregação.

Regra transversal: **nunca recomputar `PegState` de bps no cliente** — o estado vem do
servidor (`state`/`state_reason`), hysteresis mora no engine (ADR-0023).

## Nota de sequenciamento (honestidade estratégica)

O veredito permanente é "demand is the gap" (0 pagantes). W3 ≈ 3-5 sessões-landing
(estimativa do MAPA, confirmada — a maior onda do rebrand). Vale sequenciar em blocos
(W3a rende o salto de coerência sozinho e é a fração barata) e intercalar com o trabalho
de demanda (tokens.xyz, design partners). Decisão do founder.
