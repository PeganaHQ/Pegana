# W3 execution log (living doc — atualizado por bloco)

> Iniciado 2026-07-10 após ready ("Vamos fazer 100%"). Contrato: Sonnet implementa ·
> Opus revisa adversarial · Fable orquestra/aprova · QA Playwright numérico por bloco ·
> SEM artifact gate (dispensado) · execução contínua bloco a bloco até o app completo
> (W3a→W3b→W3c→W4) · parar no "50%" do Rafael · zero AI slop · nunca push origin/main.
> Worktree: `.claude/worktrees/agent-a7bb15fca70bd58f2` branch `landing/v2-port`.
> Base de verdade: `2026-07-10-w3-app-analysis-VERDICT.md` + MAP + brand.md/DESIGN.md (worktree).

## ✅ W3+W4 IMPLEMENTAÇÃO COMPLETA 2026-07-11 ~2h30 — 8 commits (`61ef71a`→`90b697b`), 567/567 testes, axe suite 12 rotas. B6 fechou: gradiente eliminado dos 2 botões do app (account-chip = único momento do chrome), themeColor + relíquias V1 dos OGs corrigidos. PENDENTE: founder destrava Vercel → QA visual completo → julgamento Rafael → merge (decisão dele).

## STATUS anterior ~2h: ✅ TODAS AS SUPERFÍCIES DO APP EM V5 — 7 commits: B1 `61ef71a` (fundação tokens) · B2 `3994231` (chrome) · B3a `e9bd50e` (screener) · B3b `8cd1042` (dashboard) · B4a `9dec26d` (flagship+scrub) · B4b `4baa2b0` (compare/events/cmd-k) · B5 `e78c33b` (forms/account/auth) · B6 sweep final EM CURSO (axe spec + hex audit) · 567/567 testes (+45 novos na jornada) · ⛔ VERCEL BLOQUEANDO DEPLOYS DESDE 61ef71a (founder) → QA VISUAL PENDENTE

- B5: Opus SHIP direto, 567/567 (+6). 5 primitivos ui/ novos (Label/Input/Textarea/Select nativo/Field c/ role=alert), account 4 páginas + gate + modal de conflito com testes pinando ordem de args, auth/magic V5 (sanitizeNext + location.replace byte-idênticos), threshold-unification investigada e corretamente NÃO forçada (semânticas distintas).
- PENDENTE (na ordem): (1) founder destrava Vercel → (2) QA visual Playwright completo de TODOS os blocos no preview (desktop 1440 + mobile 390 + reduced-motion + axe manual; tokens computados, glass topbar, scrub, verbos palette, forms) → (3) Rafael julga no celular → (4) fixes de QA se houver → (5) decisão de merge é dele.
- Follow-ups conhecidos (não bloqueiam): banners com blur pré-existente (glass-law estrita); backtest/page.tsx:69 hex velho (page é V2-chrome, W5); embeds = contrato W5; monogram stable_yield/NEUTRAL recoloridos (#a8c65a/#96918c) — validar visualmente no QA.

- B4b: Opus SHIP direto, 561/561 (+5). Compare: hero compacto, pill-tracks, cards→painéis 16px, pill de estado canônica (2 violações Capitalized pré-existentes corrigidas). Events: DNA timeline-v2 portado sem importar escopo, filtros pill c/ counts (+severity mobile novo), 3 mapas duplicados→stateMeta. Palette: verbos watchlist (store real, aria-live, nunca silencioso) + Compare {SYM}, cap 6, só em matched assets.
- B5 spec: primitivos ui/ form (input/textarea/select nativo/label/field; inputs 10-12px NÃO pill), account 4 páginas + gate + sidebar open-air, auth/magic V5 (LÓGICA intocável: sanitizeNext + location.replace), threshold-unification = investigar e reportar, não forçar.

- B4a: scrub timeline→chart com handshake cross-tab (troca p/ Overview e entrega alvo ao montar — endossado; alternativa era mudança de IA). Opus pegou 2 data-lies pré-ship (marker obsoleto sobrevivia troca de range/mode; scrub fantasma de boolean descartado) — fixados in-loop. 556/556 (+13). Página caiu p/ exatamente 1 momento de gradiente.
- ⚠️ INCIDENTE CONTIDO: fixer B4a REVERTEU os 2 arquivos dirty do Rafael (interpretou como violação). Verificado: era churn puro do Prettier (3 passes independentes confirmaram zero semântica; conteúdo real dele está commitado em d7f914c — asserções "63" presentes no HEAD). Nada perdido. Prompts seguintes corrigidos: "não editar E não reverter o estado dirty".
- Restante pós-B4b: B5 = W4 (linguagem de form + account/* + auth/magic); depois sweep final (axe suite p/ /compare /account /asset, e2e sanity) + QA visual acumulado quando Vercel destravar + handoff.

- B3b: Opus SHIP direto. Dashboard já estava ~V5 (rebuild jun + flip B1); mudou só: peek pane = objeto-painel (r16, wash confinado ao header), filter-sheet geometria V5, onboarding-modal restyle completo (era o último organismo em chrome velho). Hook NÃO adotado — razões documentadas (classe exata vs agrupada; hook sempre ordena; liveOverrides memoizado do dashboard é superior). Wash de estado no header do peek aceito por Fable (tint semântico ≠ gradiente de marca).
- B4a spec: hero mantém mapas locais deliberados; tabs URL ?tab= intactos; scrub = forwardRef scrubTo/clearScrub via setVisibleRange+markers (primitivos do compare-chart); out-of-range = hint honesto, sem fetch; Esc limpa; marker na cor do estado low-alpha. Depois B4b: /compare + /events pass + cmd-k verbs.

- B3a fechado: Opus FIX-THEN-SHIP → monogram collision corrigido in-loop (#a8c65a yield / #96918c neutral); decisões Fable aplicadas por agente polish: régua do sparkline NUNCA estende domínio (só desenha se threshold ≤20% da borda natural — pegged mantém forma 24h), atRisk global (população = universo, igual ao total), testes state asc/desc. 543/543. Divergências legítimas registradas: stale-sort-last generalizado p/ toda chave/direção (fix H1/H9), state-sort delega a compareWorstFirst (tie-break por proximidade), série sparkline convertida p/ bps (fix de unidade necessário p/ régua).
- B3b spec no workflow: 3-panes mantido, hook adotado SÓ onde não muda comportamento (WS-merge fica local — invariante nº1), severity-collapse do dashboard fica local, onboarding full-modal locked (restyle only).

- ⚠️ Lição de QA: string "switzer" aparece no flight payload do deploy VELHO — NÃO é marcador de deploy novo. Marcador correto = tokens computados via Playwright (--color-canvas #0a0a0b) ou "app-chrome-glass" no HTML.
- QA Playwright confirmou preview atual = deploy velho (canvas #000, radius 0, Geist). Console 10+ erros = env NEXT_PUBLIC_* ausente no Preview (issue antiga conhecida, founder task).

- Opus B1: SHIP (C1 aceito como intencional — ticker UNKNOWN converge p/ canônico; C2 corrigido no B2; C3 aceito). Opus B2: FIX-THEN-SHIP, 1 issue (banner offset desktop 73→57px) corrigido in-loop `lg:top-[57px]`. Follow-ups anotados: banners ainda têm blur pré-existente (glass-law, minor); backtest page.tsx:69 hex velho; monogram = decisão B3.
- QA plano: Playwright no preview (bypass token + branch alias): /dashboard /assets /asset/jitoSOL /events /account /compare — canvas #0a0a0b, estados V5, Switzer no html, radius, banners sob topbar, sem gradiente no chrome, mobile 390 + desktop 1440, console limpo.
- Curl do preview FUNCIONA (200 + HTML); css agora em /_next/static/chunks/*.css.

## BLOCO 1 — Fundação mecânica (W3a parte 1) — SHIPPED `61ef71a`

Workflow `wf_1a765a08-819` (resumível por cache). Implementador Sonnet CONCLUIU
(tsc limpo, vitest 522/522, uncommitted no worktree):
- globals.css → tokens V5 completos (canvas #0a0a0b, surfaces #121214/#17171a, hairlines
  rgba, estados V5, gradiente 5-stop, tick-flash coral, radius 16px + derivação shadcn),
  bloco light DELETADO. AA verificado: depeg-text/critical-text = alias das bases
  (6.06-6.70 / 4.81-5.32:1; critical apertado, comentário inline avisa).
- Fontes: root layout → switzerV2+geistMonoV2 (Geist/JetBrains removidos); rebind via
  `@theme inline` (pitfall Tailwind v4 corretamente evitado); preload agora site-wide.
- Light mode: já era forcedTheme dark; zero consumidores de toggle; embed-client é
  funcionalidade (preview de badge p/ terceiros), intocado.
- `lib/asset/state-meta.ts` NOVO (canonical stateMeta; BLACK_SWAN label próprio, cor de
  CRITICAL). state-class.ts delega (8 consumidores intactos). 12 arquivos migrados
  campo-a-campo SÓ onde byte-idêntico; mantidos locais os que divergem de propósito
  (verb-forms "Drifting/Depegged" em asset-rail/asset-hero, UNKNOWN full-contrast no
  hero, BAND_STROKE da timeline, uptime-bars inteiro skipped).
- Sweep: OG image (+twitter via re-export) V5, tv-chart DEFAULTS (11 campos),
  use-tick-flash (2 fallbacks), mouse-spotlight (stops V5 mesmas alphas). Embeds/corner-
  marks/telegram-colors intocados (por design).
- button.tsx → rounded-full (exceção documentada: button-group). badge.tsx SKIPPED
  (header do próprio arquivo documenta sharp deliberado — divergência correta do spec).
- SWR: useAlerts com chave compartilhada `alerts|shared-60` p/ consumidores globais ≤60
  (4 pollers → 1), slice client-side; asset/since/500 ficam fora. SWRConfig no ROOT
  (LiveAlertBubble/LiveThisWeek rendem em marketing também). PENDENTE OPUS: confirmar
  newest-first do /v1/alerts (slice do head depende disso).

Interrupções: 2 quedas de internet do Rafael mataram a revisão Opus 2×; workflow
retomado via resumeFromRunId (refs/docs/impl vêm do cache). Task atual: wmsfxjyut.

Após revisão+fixes: Fable review final → commit POR CAMINHO (nunca -A; excluir os 2
dirty do Rafael: `web/components/organisms/v2/site-chrome-v2.tsx`,
`web/tests/unit/organisms/v2-fallback-asset-count.test.tsx`) → push landing/v2-port
(inclui d7f914c dele) → QA Playwright preview (bypass
`?x-vercel-protection-bypass=e8bKUgvGVMpkfy9Lnf8zLtMejhAhoett&x-vercel-set-bypass-cookie=true`,
alias `pegana-git-landing-v2-port-lrafasouzas-projects.vercel.app`): canvas #0a0a0b,
estados V5, Switzer, radius, mobile 390 + desktop 1440, console limpo.

## BLOCO 2 — Chrome V5 (W3a parte 2) — SPEC PRONTO (endossado por Fable)

Base: relatório de referências medido no DOM real (scratchpad `w3/refs-chrome.md` +
screenshots `w3a-refs/`; DefiLlama/Dune/Grafana/Birdeye/Linear/Vercel/tokens.xyz).
Decisões endossadas:
1. **Topbar horizontal FICA** (IA 5-6 rotas; sidebar = rejeitado, mudança de IA fora do
   mandato). Altura: MANTER 73px exato (constante `top-[calc(73px+...)]` no MobileMenu).
   Sticky, bg `color-mix/rgba` do canvas a ~72% + `backdrop-filter: blur(20px)` (valor
   medido do Linear; DESIGN.md sanciona glass SÓ na navbar), hairline 1px `--color-hairline`
   PERMANENTE (rejeitado o pop-on-scroll do Vercel).
2. **MATAR o underline gradiente** da nav ativa (topbar) e a barra gradiente por tab
   (tab bar) — violam o racionamento do gradiente. Ativo = `text-dim → text` (Switzer
   14px/500) com opcional 1px sólido `--color-outline`. Tab bar: barra ativa 1.5px sólida.
3. Search/⌘K: pill 32px de altura (número convergente Grafana/DefiLlama), label
   `Search` + kbd mono `⌘K`; manter shape atual, re-tokenizar.
4. **Sem pulse/live dot no chrome** — live-ness mora nos dados (StatePip), nunca decoração.
5. Tab bar mobile: 64px fica, ícones 20px, labels 11px, border-top hairline, blur
   mantido, REDUZIR a sombra pesada (0_-18px_60px → flat/hairline register).
6. Command palette: IA intacta (grouped Go-to/Assets + StatePip + spread mono — já
   supera as referências); re-tokenizar hairlines/surfaces; accent ativo = coral FLAT
   (#ff8a5b, já correto por comentário no arquivo).
7. Banners (Health/WS/Mock): faixa única colapsável ABAIXO do topbar, ≤36px, padrão
   honest-degradation existente; nunca empilhada acima (rejeitado Birdeye).
8. DottedGridBg: avaliar manter/suavizar no canvas V5 (decisão no bloco).
9. dashed-corner-marks no asset-preview-pane: APOSENTAR (afford. terminal) — pode entrar
   aqui ou no Bloco 3 (tela do dashboard).

## BLOCO 3 — W3b (uma superfície por vez, cada uma com loop Sonnet→Opus→fix)

### B3a — /assets screener (spec Fable, endossado)
- Reconstruir a APRESENTAÇÃO de `app/(app)/assets/page.tsx` na linguagem V5 inner:
  idiom ListRowsV2 (hairline rows open-air, header mono caps, SEM caixa de tabela),
  densidade medida DefiLlama: header ~46px, rows ~50px. Página ganha PageHero compacto
  (eyebrow+título+meta) no lugar do header atual.
- MANTER 100%: sort por URL (?sort=&dir=), colunas (State pill canônica via stateMeta,
  Spread com spreadTextClass, band gauge →depeg, Stability/jitter, Safety grade com
  disclaimer "heuristic" persistente, sparkline), freshness-gate (stale→Unknown, null
  bps/prox, stale sort-last SEMPRE), sr-only sort announcer, roving/keyboard, paridade
  mobile (cards <860 mantêm gauge/spark/stability/safety — anti-regressão explícita),
  backend-down ≠ filtro vazio, deprecated suppression.
- UPGRADE: linha de threshold no sparkline (dashed no nível depeg do próprio asset,
  via thresholdsFor — mesma fonte do worst-sort). Cor: hairline/dim, NUNCA vermelha
  (não é alarme, é régua).
- Extrair `lib/hooks/use-screener-state.ts` (filter class + search + sort + clock tick
  + rows freshness-derived) SÓ para esta página agora; dashboard adota no B3b (converge
  os 3 clusters duplicados; events no B4).
- monogram.ts (paleta de classe): alinhar stable_yield #6bd697→#5fd3a0 e NEUTRAL
  #9aa9b8→#8f8aa3 (mantém identidade por classe, tons V5).
- Regra dura: effectiveState/compareWorstFirst/thresholdsFor IMPORTADOS, nunca
  recomputados; PegState nunca derivado de bps no cliente.

### B3b — /dashboard (após B3a shipped)
- 3-panes IA MANTIDA (240/lista/360). Reskin V5: sidebar open-air hairlines (sem
  caixa), lista = rows hairline, peek pane = painel #121214 r16 (é um objeto).
  Adotar use-screener-state. StatStrip do topo → StatStripV2. EngineFlowStrip mantém
  (liveness = dado, sancionado). OnboardingModal: restyle V5 (padrão locked, full
  modal walkthrough fica). MobileAssetRow → linguagem de cards V5. Corner-marks já
  removidos (B2). Crown jewels: liveOverrides gate, worst-first peek default,
  LiveStateAnnouncer, roving tabindex, backend-down state.

## BLOCO 4 — W3c flagship+chart · BLOCO 5 — W4 forms
Specs no VERDICT doc §Plano. Upgrades aprovados: timeline→chart scrub + cmd-k verbs
(B4). Contratos como teste: 404≠503, B-023 redirect, URL params, copy do verifier,
axe 2 viewports (adicionar /compare, /account, /asset/[symbol] à suíte).

## Crown jewels (não regredir — file:line no VERDICT doc)
freshness/worst-sort/live-context/reconcileBps/policy intocáveis; spread Pegged neutro;
nunca recomputar PegState client-side; a11y announcers; backend-down ≠ filtro vazio.

## r5 (2026-07-14) — paridade + auditoria completa. DeepSeek V4 flash via opencode = implementador (Fable revisa diff direto, sem Opus; "cuidado com tokens")
- SHIPPED `c78358d`: dashboard board ganhou Stability+Safety (paridade de colunas c/ /assets). DeepSeek impl + Fable pegou 1 violação (jitter emprestou cores de estado → neutralizado nas 2 tabelas).
- Auditoria (wf_a11b6a97-79d, 2 agentes): sweep visual + gap de código. Veredito desafiado:
  - EXECUTANDO via DeepSeek: Lote A (compare: hover ring-2 nos cards + BUG sparkline cor errada + range→PillTabs) `b23ahee48`; Lote B (peer-comparison→tabela real card V5 + account/alerts table→card) `bckc3li0u`.
  - MATADOS (genérico/marketing/env): glass-law sweep (regra provável defasada), /pricing matrix+toggle (marketing morto), /status+/releases+/backtest nav (trust público intencional), exit-liquidity chart vazio (=preview sem Jupiter ao vivo, prod ok), tabs-mobile fade-edge (micro-polish).
  - DECISÃO DO FOUNDER (não toco): embeds paleta velha #3fa776 (contrato público, breaking visual); /account sidebar desktop border-l laranja V1.1→pills (mudança de layout, quer artifact?); dead-code 1.625 linhas órfãs (sidebar/peek/table antigos — delete quando ele quiser).
  - Reports: scratchpad/w3r5/{visual,code}.md.

## /asset re-imagination — Phase 1 (2026-07-14, Opus conta 2) — verdict-first, FE-only
Spec: `2026-07-14-asset-reimagination-SPEC.md` (verdict-first premium; hero/rail→cards, every
tab panel→card, 3 fake tables→real, 2 data bugs fixed; Emil Kowalski + Apple craft rules
folded in). Spec commits `f278270`+`15d90c4`. Loop per surface: Sonnet/DeepSeek implement a
bounded spec → Opus adversarial review (Before/After/Why + crown-jewel check) → Opus runs
tsc+vitest (585 baseline) → commit by explicit path. Push batched to the first visible unit.
- **S0 / Bug A `7c29bda`**: `page.tsx` adopts `effectiveState(undefined, asset, now)` (page-level
  30s clock) — stale snapshot degrades to Unknown across hero/rail/tabs (was raw `asset.state`,
  only StaleBanner warned). Sonnet impl, Opus review 0 issues.
- **S1 / verdict card `b9f8cb7`**: hero → premium `rounded-[20px]` card, state elevated to a
  co-lead readout beside the number, Pyth trust signal, "Verified state history" receipt/replay
  moat link, state-dot glow killed. Presentation only; all data comps byte-identical. Sonnet.
- **S2 / rail card `5660108`**: rail → premium card (was open-air), 4 sections as internal
  hairline blocks, glow killed, Pyth removed (single source now the hero). DeepSeek V4 impl;
  Opus cleaned stale comments + orphan line. DeepSeek FE channel validated on a bounded task.
- ABOVE-FOLD (S0+S1+S2) pushed for Rafael's judgment on the alias.
- **S3 / Overview `5b2b6b8`**: recovery-confidence → full premium card; arbitrage-hint → quiet
  subordinate card; exit-liquidity → real `<table>`+colgroup+shared COL_PAD inside the card
  (fake grid killed) + mobile sibling list. Presentation only; fetch/UNKNOWN/reflow byte-
  identical. DeepSeek (card-wraps) + Sonnet (exit-liquidity); Opus review caught + fixed a
  DeepSeek flex-layout regression on recovery-confidence. Chart left full-bleed (design call).
  Note: a pre-existing flaky exit-liquidity test teardown error surfaces ~1/3 full-suite runs
  (async fetch/timer settling post-unmount) — non-failing, 585/585, unrelated to the re-skin.
- **S4 / History `295fb04`**: time-to-recovery + state-strip-30d + activity-timeline → premium
  cards; comparable-events episode cards → rounded-[16px] + hover DNA (no card-in-card); the lone
  `border-dashed` empty state killed; all 4 headings unified to display `<h2 text-[28px]>`.
  Presentation only; scrub/dedup/sparklines/a11y byte-identical. DeepSeek (3) + Sonnet (timeline).
  Note: opencode format-on-save prettier-churns committed files — now I `prettier --write` my
  files before each commit to stop it (asset-hero-v2 normalized in `1`-line style commit).
- **S5 / Mechanism `d9eece0`**: mechanism-flow → premium card (SVG bar + suspect banner + reveal
  preserved); nav-backing → two boxes merged into one card w/ internal divider; yield-source →
  quiet card; alert-policy ladder → real `<table>`+colgroup+card (fake grid killed). Presentation
  only; reconcileBps/suspect/hyUSD-CR/black-swan/engine-constants byte-identical. Sonnet (2) +
  DeepSeek (2); Opus review cleaned nav-backing double-padding.
- **S6 / Risk `c06a89d`**: safety-grade → premium card (GSAP glyph + 3-dim dots + "Heuristic v1"
  label preserved); peer-comparison fake grid → real `<table>`+colgroup+card + canonical
  StatePillCell + spreadTextClass + mobile sibling. **Bug B fixed**: peers sort worst-first (was
  best-first, inverting the app convention); focus "you are here" row pinned first. Sonnet (peer) +
  DeepSeek (safety-grade).
- **S7 / Identity `3f3482e`**: identity-row → premium card; asset-action-strip 4 action cards →
  uniform `rounded-[16px]` + full card hover DNA (removed the one-off `primary` border). DeepSeek.
- **✅ PHASE 1 COMPLETE (S0–S7).** Above-fold verdict card + rail card, all 5 tabs' panels in the
  approved V5 card language, 3 fake grid-tables → real `<table>`s (exit-liquidity, alert-policy,
  peer-comparison), 2 data bugs fixed (freshness gate on the page state; peer worst-first sort),
  state-dot glow killed everywhere, the lone dashed fossil killed, headings unified. 585/585
  throughout; every crown jewel preserved (reconcileBps, effectiveState, worst-first, hysteresis
  constants, a11y, backend-down≠empty, never-recompute-PegState). Pushed across 7 preview
  checkpoints. Impl: DeepSeek (bounded card-wraps) + Sonnet (tables/large/logic) + Opus (spec,
  adversarial review, fixes, verification). PENDING RAFAEL: final judgment on the alias.
  Phase 2 (backend differentiators — engine safety score, NAV-over-time) remains demand-gated.
