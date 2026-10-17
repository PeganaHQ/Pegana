# MAPA — Rebrand V5 em todas as páginas (2026-07-03)

> Síntese de: workflow de 7 clusters read-only sobre o código (worktree `landing/v2-port`, 960k tokens, 331 tool calls)
> + varredura visual Playwright da produção (29 capturas full-page, desktop 1440 + mobile 390, em `.playwright-mcp/v1-sweep/`).
> Entregável da etapa "mapeie tudo, estude tudo".
>
> **ATUALIZAÇÃO (mesmo dia): ready dado. Decisões do Rafael: /pricing continua morto · wordmark gigante aposentado · light mode morre · resto delegado às recomendações deste MAPA. W0 SHIPPED (`f69a38b`) e W1 SHIPPED (`bfed2c2`) no branch `landing/v2-port`: chrome V5 em todas as páginas de marketing+backtest (NavV2 variant site + FooterV2 canônico 5 colunas), 4 superfícies de erro recriadas (ErrorSurfaceV2, artifact r1 `https://claude.ai/code/artifact/6c081dc9-2432-47a5-a8d7-8c67d9c21248`), og-v4.png, dark-only. QA Playwright no preview: overflow 0, 1 nav + 1 footer por página, canvas #0a0a0b unificado. Próxima onda: W2 (prosa/trust).**

---

## 1. O estado real: dois sistemas velhos + V5 ilhado

O site vivo NÃO tem "um design antigo" — tem **dois**, e o V5 é uma ilha:

| Sistema | Onde vive | Assinatura |
|---|---|---|
| **Marketing velho** | /methodology /audit /changelog /about /agents /privacy /terms /backtest /embed /pricing + 404/error | Preto #000, Geist + JetBrains Mono, gradiente iridescente **amarelo→laranja→lavanda** (#feed7a→#ff8400→#df91f7), hairlines quadradas, glow radial copiado 4× verbatim |
| **App shell velho** | /dashboard /assets /asset/* /compare /events /status /account/* | Mesmos tokens + DashboardTopBar/CommandPalette/MobileTabBar/DottedGrid, labels de estado minúsculas ("pegged"), mono-UPPERCASE denso |
| **V5** | somente `/` (branch, nem em prod) | zinc #0a0a0b, Switzer + Geist Mono, coral #ff6b5e→lavanda #a78bfa, pills brancos, grain/aurora |

Detalhes que importam:

- O V5 está **100% escopado** em `.pegana-v2` + `v2.css` + fontes próprias importadas só por `app/(marketing)/page.tsx`. Nada dele é alcançável do root layout. O padrão atual não escala para ~25 superfícies.
- O gradiente velho é **amarelo-led**; o V5 é **coral-led**. Compartilham um hex por coincidência. Todo o site velho "parece quase" a marca nova sem ser — é exatamente o efeito "quase-premium" que o rebrand mata.
- A onda do logo (path SVG) já é **byte-idêntica** entre BrandMark velho e BrandLockupV2 — o logo não precisa de redesign, só o chrome ao redor. (Mas os stops do gradiente do BrandMark velho divergem dos tokens V5 canônicos — alinhar.)
- O app velho **não é slop**: pills rounded-full, hairlines, momentos de gradiente comedidos. E quase toda cor flui por CSS custom properties (`--color-*`), **inclusive o tema do chart** (lê `getComputedStyle` em runtime). Consequência enorme: retokenizar `globals.css` re-skinna a maior parte do app quase de graça. O gap real é tipografia (Switzer), formas, casing de labels e os organismos densos.
- Prod ainda serve a **landing velha** — o V5 só existe no branch `landing/v2-port` (segurado por decisão).

## 2. Inventário completo (rota → era → complexidade)

Complexidade: S = retoken/restyle · M = restyle + alguns padrões novos · L = precisa de organismos V5 novos · XL = redesign completo estilo landing.

### Chrome global (alavanca nº 1)
| Superfície | Era | Cx | Nota |
|---|---|---|---|
| Root layout (fonts/OG/tokens/tema) | velho | L | **A porta de mão única** — ver §4.1 |
| (app) shell: topbar+palette+banners+tab bar+footer | velho | **XL** | Zero equivalente V5; gateia 10+ páginas autenticadas |
| (marketing) layout: MarketingHeader+UtilStrip+CalibrationBanner | velho | L | Duplicado verbatim em `app/backtest/layout.tsx` |
| SiteFooter | velho | L | Importado por **15 page.tsx individuais** — nenhum layout o renderiza |
| not-found.tsx (o 404 que o Rafael viu) + error.tsx + global-error | velho | S | Ainda usa brackets `[ ROUTE_NOT_FOUND ]` — identidade **aposentada**; e CTA morto p/ `/developers` (rota inexistente) |
| OG images (og-v3.png + asset/[symbol] + audit/[id] dinâmicas) | velho | M | Dinâmicas hardcodam paleta velha + Geist via Google Fonts scraping; Switzer exigirá bytes self-hosted p/ satori |

### App core
| Rota | Era | Cx | Nota |
|---|---|---|---|
| /dashboard | velho | L | 3 painéis alinhados a 240px do topbar (contrato de grid); onboarding modal 5 passos (padrão locked — restyle, não remover) |
| /assets (screener 63 ativos) | velho | L | O "Live peg board" do hero-v2 JÁ é um protótipo de screener V5 — elevar, não inventar |
| /asset/[symbol] | velho | **XL** | Página mais profunda do produto: chart c/ 5 modos, tabs, rail, "What we think", Recovery confidence, Exit liquidity |
| /compare | velho | L | Presets + overlay de até 4 ativos |
| /assets/[symbol] | — | n/a | Só redirect p/ canônico /asset/* (documentado B-023, não é bug) |

### App secundário + auth
| Rota | Era | Cx | Nota |
|---|---|---|---|
| /events | velho | L | Heatmap 52 semanas + cards c/ sparkline; filter pills já quase-V5 |
| /status | velho | L | Uptime bars por fonte + incident log (conteúdo forte, prosa longa) |
| /account (+alerts/subscriptions/webhooks) | velho | S–L | **Única linguagem de FORM do site** (input/select/radio-card/slider/switch/tabela) — V5 não tem nada disso; 2 padrões p/ "threshold" que devem virar 1 |
| /auth/magic | **sem estilo** | S | shadcn Card genérico — uma TERCEIRA linguagem, nem o sistema velho segue |

### Trust & evidência
| Rota | Era | Cx | Nota |
|---|---|---|---|
| /methodology | velho | L | Prosa longa + changelog parseado + tabela canon — exige tipografia de artigo V5 (não existe) |
| /audit + /audit/[id] | velho | L | Tabela de receipts 6 colunas; o receipt-language do trust-scene-v2 é o mapeamento óbvio — /audit/[id] vira a versão dado-real do teaser da landing |
| /changelog | velho | M | Bug visual real: coluna de release notes espremida (texto quebrando palavra a palavra) |
| /backtest + /backtest/usde | velho | S/**XL** | O replay precisa de **chart analítico com eixos/tooltip/bandas** — padrão V5 inexistente (AssetChartCanvas é ilustrativo, sem chrome) |
| /releases | velho | S | Sem nav/footer nenhum; link SHA256SUMS **404 hoje** (mina a própria mensagem "leia antes do pipe pro sh") |
| /live | — | S | Redirect p/ `/#live` — âncora que morre com a landing V5 (ver §5) |
| Feeds .xml (4) | n/a | n/a | Consumidores externos — não tocar no contrato |

### Developers & distribuição
| Rota | Era | Cx | Nota |
|---|---|---|---|
| /embed (configurador) | velho | L | Specimen cards + snippets; CodeBlock compartilhado com /agents |
| /embed/[asset] + /embed/badge/[symbol] + /embed.js | velho | S–M | **Consumidos por terceiros**; testes asseguram substrings/headers — cores livres, contrato não. Mapa de cores de estado copiado à mão **3×** (extrair p/ lib única). Badge velho colapsa DEPEG=CRITICAL na mesma cor; V5 os distingue — upgrade semântico de graça |
| /embed/demo | velho | S | **Órfã** — nada linka pra ela, nem o próprio /embed |
| /agents | velho | M | Pitch MCP/x402; CodeBlock v2 resolve metade |
| /pricing | velho | L | **Estado trino inconsistente**: página real + redirect 307 p/ `/` (pre-verdict-gate) + zero links de entrada. Forçar decisão, não redesenhar às cegas |
| /docs | externo | — | Proxy Mintlify — clicar "REST API" no footer ejeta o dev da marca; tema Mintlify c/ tokens V5 é tarefa paralela (fora do repo web) |

### Company & legal
| Rota | Era | Cx | Nota |
|---|---|---|---|
| /about | velho | L | **Conteúdo defasado**: não menciona Trust Layer/receipts/x402/MCP — a história central de hoje. Rebrand aqui é reescrita, não reskin |
| /privacy + /terms | velho | M | Helper `Section` duplicado byte-idêntico nos 2 arquivos; LAST_UPDATED "May 22" defasado; **3 e-mails de suporte diferentes** no cluster (raffxweb3@ / privacy@ / hello@) |
| Contact / Issues / License | externos | — | mailto + GitHub (ambos 200 OK) — decisão: continuar delegando ou criar página de contato |

## 3. Lacunas de linguagem V5 (o que precisa ser INVENTADO antes de portar)

Em ordem de quantas páginas desbloqueiam:

1. **Chrome de app V5** (topbar denso não-flutuante, command palette, health/ws banners, mobile tab bar) — desbloqueia 10+ rotas. Nada no v2/* endereça isso.
2. **Tipografia de prosa/artigo** — methodology, about, privacy, terms, status(incidents), audit/[id]. Zero prosa no V5 hoje.
3. **Linguagem de formulário** (input, select, radio-card, slider, switch, estados de erro) — account/*, auth. Zero no V5.
4. **Tabela densa / list-row** — assets screener, audit index, canon table. (Idioma "list-row com hairline + header mono caps" casa melhor com V5 que `<table>` literal.)
5. **Chart analítico com eixos/tooltip/reference-bands** — asset/[symbol], backtest. AssetChartCanvas atual é ilustrativo.
6. **CodeBlock V5** (painel arredondado + hover-copy, estendendo o FxChip do trust-scene) — methodology, audit/[id], releases, embed, agents. Um componente, 5 páginas.
7. **Páginas de erro/404/estados vazios** — inclui o 404 que motivou tudo isso.
8. **Onboarding modal V5** — padrão full-modal é decisão locked; só re-vestir.

Já existe e é subestimado: o board do hero-v2 é um proto-screener real (useAssets + StatePillV2 + gauge + sparkline canvas); PillPrimary/PillGhost mapeiam 1:1 nos filtros do app; StatePillV2 substitui ~8 mapas de cor de estado duplicados e conserta o casing de uma vez.

## 4. As três decisões estruturais (portas de mão única)

**4.1 Tokens no root vs escopo `.pegana-v2` por página.** O escopo atual não escala (fonte dupla, CSS duplicado, e o chart do app lê custom properties do root). Recomendação: ondas de marketing continuam no padrão escopado (provado); na onda do app, **promover tokens/fontes V5 ao root layout e deletar a paleta velha** — com o efeito colateral de que a retokenização re-skinna o app inteiro "80% V5" de uma vez (cores certas, tipografia/formas ainda velhas até cada organismo passar). Alternativa é manter tudo escopado até o fim — mais lento e nunca dá o salto de coerência.

**4.2 Light mode morre?** O app velho tem toggle claro/escuro funcional; o V5 é identidade dark única. Manter dual = cada organismo novo custa 2×. Recomendação: **matar light mode** no rebrand (produto de monitoramento, identidade de marca é o canvas escuro). É remoção de feature visível — decisão do Rafael.

**4.3 O que o V5 site-wide faz com o footer.** FooterV2 atual (da landing) é um sitemap MENOR que o SiteFooter velho: derruba Compare, Events, Embed widget, Audit log, About, For agents, Issues e a coluna **Legal inteira**, e tem link duplicado (Asset pages e Coverage → /assets). Copiá-lo site-wide como está = regressão real de conteúdo. Reconciliar com o sitemap canônico (o que o Rafael listou) antes de promover. O momento-assinatura do wordmark gigante PEGANA com parallax do footer velho: portar ou aposentar — decidir, não esquecer.

## 5. Bugs reais encontrados (independentes de rebrand)

**Merge-blockers do branch `landing/v2-port`** (viram regressão pública no dia do merge):
- MarketingHeader (usado em 8+ páginas) linka `Product→/#channels` e `Live→/#live` — âncoras que a landing V5 **não renderiza mais**. `/live` redireciona pra mesma âncora morta. Consertar no branch antes/junto do merge.
- FooterV2 incompleto (§4.3).

**Vivos em produção hoje:**
- 404 page linka `/developers` — rota que não existe (link morto na própria página de erro).
- `/releases/SHA256SUMS` → 404 real (o instalador existe, o checksum não).
- Âncoras mortas: `/account#alerts` (linkada do asset-rail) e `/about#contact` (linkada do /pricing).
- `sitemap.ts` omite /methodology, /audit e /agents — exatamente as páginas da narrativa de confiança.
- UtilStrip: `hidden` incondicional — DOM morto anunciando x402 em toda página de marketing.
- /changelog: coluna de release notes espremida (quebra palavra a palavra).
- 3 e-mails de suporte distintos; LAST_UPDATED legal defasado.
- `public/logos/pegana-wordmark-*.svg` = lockup de brackets aposentado, zero referências (deletar).
- Nota: o bug de chart "linhas de depeg do lado errado do zero" (memória 2026-06-13) **não reproduz mais** — código atual emite guias simétricas p/ stables com teste unitário cobrindo; smoke-check visual na onda do app e encerrar a memória.

## 6. Ondas de execução propostas

Processo por página = o mesmo da landing: estudo → **artifact HTML** (rodadas r1..rN, Rafael julga no celular) → port 1:1 → QA numérico Playwright (desktop+mobile+reduced-motion) → validação final dele. Uma superfície por vez (`feedback_design_pacing`), Sonnet implementa / Fable pensa e revisa.

**W0 — Batch de correções sem design** (pode andar já, independente do ready de design):
anchors do MarketingHeader + /live, FooterV2 reconciliado, 404→/docs, SHA256SUMS, sitemap, âncoras account/about, UtilStrip, e-mails, wordmarks mortos, dedupe layout backtest, SiteFooter 15 call-sites → layouts (transforma o swap futuro de 15 arquivos em 2). Puro código, zero pixel novo.

**W1 — Chrome global de marketing + superfícies de erro** (mata o "tudo está no design antigo" com o menor movimento):
NavV2/FooterV2 site-wide no grupo (marketing), 404/error/not-found V5 (a queixa original), og-v3.png regenerado em V5, decisão 4.1/4.2 formalizada. Páginas ainda velhas por dentro, mas TODA navegação/borda do site já é V5.

**W2 — Linguagem de prosa + cluster trust** (methodology → audit → audit/[id] → changelog → about → privacy/terms):
inventa tipografia de artigo + CodeBlock V5 + list-row de receipts (trust-scene-v2 com dados reais). /about ganha reescrita de conteúdo (Trust Layer/x402/MCP). É a onda que transforma V5 de "landing" em "sistema".

**W3 — App shell + core** (a maior; sugerir sub-ondas):
W3a: chrome de app V5 (topbar/palette/banners/tab bar) + retokenização do globals.css + StatePillV2 em todo lugar. W3b: /assets screener (elevando o board do hero-v2) + /dashboard. W3c: /asset/[symbol] (XL, o flagship) + chart analítico V5 + OG images dinâmicas + /compare. /events e /status herdam o shell em W3a e recebem passada de conteúdo aqui.

**W4 — Formulários & conta**: linguagem de form V5 + account/* + auth/magic + unificação do threshold control.

**W5 — Distribuição** (mais risco externo, por último, com o sistema provado):
/embed configurador + rotas de badge (cores novas c/ DEPEG≠CRITICAL, contrato intocado, testes atualizados), /agents, /backtest (chart analítico já existe da W3), /releases, tema Mintlify V5 (paralelo, fora do repo). /pricing: só se decidir reativar.

Estimativa honesta de esforço relativo: W0≈½ sessão · W1≈1–2 · W2≈2–3 · W3≈3–5 · W4≈1–2 · W5≈1–2 (em "sessões-landing", a moeda que conhecemos).

## 7. O que decidi NÃO recomendar (auto-desafio)

- **Skeletons/loading por rota em todo lugar** — só existe 1 loading.tsx no app inteiro; adicionar em massa é polish genérico, não rebrand. Entra caso-a-caso quando a página passar pela sua onda.
- **Páginas novas** (contact, bot landing, /developers in-repo, incident permalinks) — gaps reais mas são PRODUTO novo, não rebrand. Ficam registrados, fora das ondas.
- **Dual-theme V5** — ver 4.2; recomendo contra, com convicção.
- **Redesign do replay do backtest antes do chart analítico existir** — ordem errada; ele consome o padrão da W3.
- **Tocar feeds .xml, telegram-login, ou o contrato dos embeds** — consumidores externos; cores sim, contrato jamais.

## 8. Perguntas abertas para o ready (grill)

1. Tokens no root na W3 (app 80% V5 de uma vez, tipografia velha até cada organismo passar) — ou tudo escopado até o fim?
2. Light mode morre?
3. Wordmark gigante PEGANA do footer: porta pra V5 ou aposenta?
4. /pricing: reativa nesta era ou continua morto?
5. W0 pode andar antes do ready de design (é só correção)?
6. Ordem W2 antes de W3 ok? (Alternativa: app primeiro se a dor de "produto com cara velha" incomodar mais que marketing.)
