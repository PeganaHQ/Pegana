# App re-imagination — plano mestre (W3-R)

> 2026-07-11. Gatilho: Rafael rejeitou o dashboard do W3 ("meio feio", hover preview
> "totalmente perdido, torto") e pediu app completamente novo — IA, componentes e
> features repensados, com referências REAIS (Pinterest, sites, context7, Playwright),
> /grill-me + /grill-with-docs, workflow completo, kill de recomendações genéricas.
> Ele está AUSENTE: self-grill com recomendações fundamentadas, TODAS reversíveis.

## Diagnóstico por evidência (Playwright no preview, 1510×941, onboarding dismissado)

1. **Peek pane**: painel 344×799 com 3 linhas de conteúdo e ~700px vazios; margens
   `my-4 mr-4` criam 3º ritmo vertical (sidebar flush ≠ lista ≠ painel) + costura dupla
   (hairline da coluna + borda do painel). Estado placeholder é um buraco escuro gigante.
2. **Coluna de 360px permanentemente reservada para hover** — affordance desktop-only,
   invisível/inútil até interação, queima 24% da largura. Anti-padrão.
3. Sidebar duplica facetas (CLASSES All + VIEWS All), contagens repetidas ("0 TRACKED"
   no header + counts na sidebar), engine-strip flutuando sem ancoragem visual.
4. Raiz: **W3 pintou de V5 os ossos de junho**. O /assets (refeito com PageHero+rows)
   ficou bom; o /dashboard (reskin do shell 3-panes) ficou "o app velho de roupa nova".
   Confirma o advogado-rebuild do veredito de 10/07 — na tela onde ele previu.

## SELF-GRILL (grill-me em modo ausente — Q&A com recomendação; reversível = ↩)

**Q1. Escopo: app ou projeto inteiro?** → App (todas as rotas autenticadas + shell) em
re-imaginação total; marketing W0-W2 está aprovado e recém-shipado — retocar agora é
churn de trabalho aprovado. Telas do app JÁ fortes (assets, asset/[symbol], compare,
events, account, auth) são RE-AVALIADAS contra a IA nova mas só refeitas onde a IA nova
exigir — o grosso da linguagem delas sobrevive (foi aprovada nos loops Opus). ↩

**Q2. Data spine?** → Intocada (2× validada; a reclamação é 100% presentation). Crown
jewels de `lib/asset/*`, live-context, policy = lei. Zero recompute de estado. ↩

**Q3. O 3-pane com hover-peek morre?** → SIM. Substituir por: (a) camada de RESPOSTA
persistente no topo (answer-first em TODO viewport — distribuição de estados do
universo, worst movers, pulso live); (b) o BOARD como objeto principal (DNA do live
board da landing que ele AMA — ícone+spark+gauge+pill); (c) peek vira **side-sheet por
rota interceptada** (Next 16 intercepting/parallel routes): clicar linha abre sheet
URL-addressável (/dashboard→/asset/X intercepted) — deep-linkável, mobile-friendly,
zero coluna morta. Validar viabilidade no context7 ANTES de prometer. ↩

**Q4. Direções de IA a produzir (pesquisa alimenta, kill-panel decide):** 3 candidatas
— A "Command Center" (answer layer + board denso + tape de transições live);
B "Risk Map first" (visualização espacial por classe/severidade como hero, board
secundário); C "Feed-first" (timeline de eventos como espinha, board como raio-x).
Hipótese líder: A com elementos de B. Referências decidem anatomia, não vibes. ↩

**Q5. Marca?** → V5 continua LEI (tokens/type/pills/gradiente racionado — não é
rebrand). O que muda é FORMA: mais data-art em canvas (DNA distance-field da landing
no app), blocos mono densos, headers editoriais. Anti-slop: nada de bento genérico,
glow roxo, cards-por-cards. ↩

**Q6. Features novas (candidatas ao kill-panel):** incident-overlay t-aligned
("compare com out/2025" — único no mercado, receipts), risk digest diário no dashboard,
correlação/blast-radius (morta em 10/07 por custo — só volta se refs+esforço S/M),
densidade Bloomberg-editorial toggle (morta — manter morta), tape de transições live
(novo, barato: alerts stream já existe). ↩

**Q7. Processo com ele ausente?** → Pesquisa → 3 direções → kill adversarial → spec →
**IMPLEMENTAR o dashboard novo completo na branch** (preview = superfície de julgamento
dele; artifact foi dispensado por ele) via loop Sonnet→Opus→fix; DEMAIS telas só
re-tocadas após veredito dele no dashboard novo (conter blast-radius de gosto — a lição
desta rodada é que pular o gate de gosto dele custa caro). Fix isolado do pane atual =
DESCARTADO (throwaway; o rebuild é o fix). ↩

**Q8. Budget/parada?** → Regra dos 50% dele segue; checkpoints em disco por fase.

## SÍNTESE DA PESQUISA (Fase 1 completa — relatórios em scratchpad/w3r/{pins,products,tech,feats}.md)

**Medido nos produtos reais (R2):** a camada-resposta vencedora tem 3 componentes — strip
mono ultrafino sempre visível (CoinGecko/TradingView), 2-4 cards número+sparkline
(CoinGecko/DefiLlama), e sparkline POR LINHA que elimina hover (CoinGecko 69px rows;
faixa densa saudável = 50-69px). **NENHUM produto sério usa drawer/side-sheet para
detalhe** — todos click→página completa. Liveness = números reais ("3h ago"), nunca
pulso/glow. DefiLlama = fit forte (mesma métrica % off peg; mobile preserva a camada de
resposta com reflow puro). Birdeye/Dune = contraexemplos (tabela crua sem resposta;
loading monolítico). Dribbble (R1; Pinterest = login-wall, reportado): Vaulto = ritmo
hero-stat-first + heatmap-calendário; provas-negativas = 3-panes de terminal + glow neon.

**DECISÕES DE SÍNTESE (Fable, evidence-based; ↩ = reversível na volta dele):**
1. **Side-sheet interceptado: MORTO** apesar de viável (R3 confirmou sintaxe Next 16) —
   zero evidência de uso nos melhores; click→/asset/[symbol] (já forte pós-B4a) é o
   padrão medido. Auto-correção da minha hipótese Q3 do self-grill. ↩
2. **Dashboard novo = "Command Center" evidence-based**: (a) strip mono agregado no topo
   (universo, estados, entrega de alertas — dados do /v1/stats); (b) RISK DIGEST
   determinístico (feature d, esforço S, dado 100% real); (c) 3-4 answer-cards com
   sparkline (worst movers / drift count / recovered 24h); (d) **RISK MAP SVG** —
   assinatura única: treemap por classe, área = magnitude do desvio (|bps|/proximidade
   — NUNCA TVL, que não existe como dado), cor = estado (nenhum concorrente tem mapa de
   risco de peg dedicado; TradingView é escala genérica de retorno em canvas
   inacessível — o nosso é SVG/DOM acessível); (e) BOARD denso 52-56px com sparkline
   +threshold-ruler por linha (já construído no B3a) + band gauge + pill; (f)
   **TRANSITION TAPE quase-live honesta** (30s, dedup (asset,from,to) com ×N, filtro
   UNKNOWN); (g) sidebar atual MORRE (facetas viram pills no board; watchlist vira
   view-pill; pinned events vão para a tape/digest). Coluna de hover MORTA. ↩
3. Features: digest (S) e tape (S/M) e risk-map (M) ENTRAM no dashboard novo;
   incident-overlay = V2 do backtest, fora desta onda (L, 1 incidente empacotado). ↩
4. Marca V5 inalterada; row heights e anatomia por números medidos, não vibes. ↩

## FASE 2 — grill-with-docs (self-grill; glossário + design records)

Nota de método: o repo tem docs/adr como série NUMERADA da methodology (pública via
subtree) — poluir com ADRs de UI seria errado. Design records ficam AQUI (DR-1..3),
mesmo trilho dos docs de design-research. CONTEXT.md não criado pelo mesmo motivo.

**Glossário afiado (termos que o spec usa com precisão):**
- **Answer layer**: o conjunto strip-mono + digest + answer-cards ACIMA do board.
  Responde "há algo errado agora?" sem interação. Não é "hero" (não é marketing).
- **Risk-magnitude**: `bandProximity` (lib/asset/band.ts — 0..1, distância à banda de
  depeg DO PRÓPRIO ativo), NUNCA |bps| cru (contradiria worst-first: banda larga a
  80bps ≠ risco de banda apertada a 30bps da própria linha) e NUNCA TVL (não existe).
- **Transition tape**: transições REAIS (from≠Unknown E to≠Unknown — mesmo filtro do
  live-this-week.tsx), fonte /v1/alerts poll 30s, dedup por (asset,from,to) em janela
  com colapso "×N". Copy NUNCA promete tempo-real: granularidade honesta = 30s.
- **Digest**: template determinístico sobre useStats() + useAlerts({since:24h}).
  Zero LLM, zero causalidade inventada — só fatos estruturados (lei DESIGN.md §honesty).

**DR-1 (irreversível na prática, surpreendente, trade-off real): o dashboard 3-panes
com hover-peek morre — recém-shipado no B3b e JÁ substituído.** Contexto: B3b reskinou
os ossos de junho; Rafael rejeitou; pesquisa mediu que nenhum produto sério depende de
hover para contexto (sparkline por linha + answer layer eliminam a necessidade) e a
coluna reservada de 360px é desperdício estrutural. Alternativas: consertar o pane
(rejeitada — trata sintoma), side-sheet (ver DR-2). Consequência: /dashboard vira
Command Center de coluna única; asset-preview-pane.tsx e dashboard-sidebar.tsx saem do
dashboard (arquivos preservados até a limpeza final).

**DR-2: side-sheet por rota interceptada REJEITADO apesar de tecnicamente viável.**
R3 confirmou a sintaxe (Next 16: @sheet + (.)asset + default.tsx obrigatório + rota
vazia para fechar em soft-nav). R2 mediu: zero produtos sérios usam drawer para
detalhe; todos click→página. Nossa página de asset é forte (B4a). Adotar seria
complexidade por modernidade, não por evidência. Revisitar SÓ se surgir demanda real
de preview sem perder contexto (ex.: comparação lado-a-lado em research flow).

**DR-3: Risk Map codifica área=bandProximity (floor mínimo de tile), cor=estado,
agrupado por classe, em SVG/DOM (nunca canvas).** Único no mercado (TradingView =
escala genérica de retorno em canvas inacessível; DefiLlama nem tem mapa). Dia calmo
= mapa visualmente quieto (tiles no floor) — semântica correta, não bug. Acessível:
cada tile é elemento real com aria-label "SYM, Pegged, 12 bps da banda". Squarify
hand-rolled (~100 linhas, N=63) — SEM d3 (dependência nova recusada).

## PIPELINE (status vivo)

- [x] FASE 1 — Pesquisa REAL — 4 relatórios + ~30 screenshots em scratchpad/w3r/.
- [x] FASE 2 — grill-with-docs: glossário + DR-1/2/3 acima.
- [x] FASE 3/4 — Killer Opus (veredito integral em scratchpad/w3r/ + task output):
      **MATOU risk map** (DR-3 revogado: universo calmo = 0 variância nos 2 eixos;
      grid verde uniforme; founder esconderia na demo) e **tape always-on** (cadência
      real 0-1/dia; feed vazio = pior sinal de liveness → vira 1 linha "last
      transition Xh ago" no digest/strip); **cards TRIMADOS p/ 2 always-meaningful**
      (Closest-to-band — sempre tem #1; Most volatile 24h via pegJitter — nunca zero);
      sidebar-kill e side-sheet-dead MANTIDOS; overlay fora MANTIDO. **LEIS NOVAS:**
      (1) desenhar o DIA CALMO primeiro — repouso confiante e intencional; (2) a
      assinatura = VEREDITO worst-first + afford. de replay/receipt (moat real), não
      widgets; (3) liveness só por timestamps reais, NUNCA motion/glow. Correção
      Fable ao killer: app/(app)/assets/[symbol] NÃO é duplicata — é o shim B-023
      (crown jewel), intocável.
- [ ] FASE 3/4 — direção sintetizada acima; killer adversarial único antes do spec.
- [x] FASE 5 — COMMAND CENTER SHIPPED `8274310` + fix `ee3efdd` (strip esconde em
      outage). page.tsx 901→578; novos: lib/asset/digest.ts (puro, 21 testes),
      universe-strip, dashboard-verdict, answer-card, dashboard-board-row (1 markup
      responsivo substitui fork AssetTable/MobileAssetRow). 598/598 testes (+31).
      Opus review FIX-THEN-SHIP (1 issue real: facetas FX/RWA — corrigido; calm-day
      law e crown jewels PASS traçados linha a linha). Removidos do dashboard (arquivos
      ficam): DashboardSidebar, AssetPreviewPane, EngineFlowStrip, FilterSheet,
      MobileAssetRow, AssetTable. Receipt-link real: /audit/{AlertRow.id}. QA visual
      meu no preview: outage-state limpo, mobile 390 sem overflow, tab bar ok.
- [x] FASE 6 — Relatório entregue. **PENDENTE RAFAEL: (1) julgar o dashboard novo no
      alias da branch (com env API no Preview ou em prod ele mostra o dia calmo:
      "All 63 assets holding peg." + digest + 2 cards + board); (2) product call: CTA
      "Open @PeganaWatchBot" foi removida do dashboard (existe no footer/onboarding/
      asset-rail) — restaurar em algum lugar do dashboard?; (3) se aprovar a
      linguagem, decidir se levo o veredito answer-first ao mobile das outras telas.**

## Fatos de ambiente (para QA honesto)
Preview sem env NEXT_PUBLIC_* (API/WS → localhost → CSP block): telas mostram estados
backend-down (que ficaram CORRETOS e bonitos — ver assets/asset 503). Telegram widget
"Bot domain invalid" no preview = artefato de domínio, prod OK. Dados reais só em prod.
