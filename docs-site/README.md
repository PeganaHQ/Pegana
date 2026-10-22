# Pegana docs site (Mintlify)

The public docs for Pegana, served at **[docs.pegana.xyz](https://docs.pegana.xyz)**.
Powered by [Mintlify](https://mintlify.com/).

> **Architecture:** Mintlify hosts the docs directly at `docs.pegana.xyz` (custom
> domain). Legacy `/docs/*` paths on `www.pegana.xyz` are permanently redirected
> to the docs subdomain via `web/vercel.json`. **`DEPLOY.md` is the source of
> truth** for how docs ship — read it before changing anything here.

## Structure

```
docs-site/
├── docs.json                # Mintlify config — navigation, theme, integrations
├── introduction.mdx         # Landing page
├── quickstart.mdx           # 5-minute integration
├── authentication.mdx       # Public API, no auth
├── pricing.mdx              # All free
├── faq.mdx
├── changelog.mdx            # Canonical developer changelog
├── concepts/                # 8 concept primers
├── methodology/             # 5 methodology pages (overview, intrinsic, market, spread, honesty)
├── guides/                  # integration guides (REST, WS, MCP, Embed, API essentials)
├── case-studies/            # 6 retrospectives (USDC-SVB, UST, mSOL, DAI, GHO)
├── api-reference/
│   ├── openapi.yaml         # Historical fallback; live spec comes from api.pegana.xyz/openapi.json
│   └── introduction.mdx
├── logo/                    # SVG logo (light + dark)
├── images/                  # Favicons, OG, depeg curves
└── snippets/                # Reusable MDX fragments
```

## Local development

```bash
# Install the Mintlify CLI once
npm i -g mintlify

# From inside docs-site/
cd docs-site
mintlify dev
# Opens http://localhost:3000
```

The CLI auto-reloads on file changes. For OpenAPI changes specifically, you may
need to restart (`Ctrl+C`, `mintlify dev`).

## Deployment

Mintlify deploys via GitHub integration. The Mintlify GitHub app is installed
on the private source repository (not on the public mirror at
[`github.com/PeganaHQ/Pegana`](https://github.com/PeganaHQ/Pegana)) and points
at this `docs-site/` directory.

- Pushes to `main` → publish to `docs.pegana.xyz`
- Pull requests → preview URLs

## Custom domain

In Mintlify dashboard → **Settings** → **Domains** → add `docs.pegana.xyz`.

DNS (Cloudflare / your registrar):

```
docs.pegana.xyz   CNAME   cname.mintlify.builders.
```

Allow ~15 minutes for cert provisioning.

## Brand theme

Set in `docs.json`:

- `theme: "maple"` — closest match to Pegana's sharp/mono aesthetic from Mintlify's preset set
- `colors.primary: "#ff8400"` — sunset coral (mid-gradient)
- `colors.light: "#feed7a"` — yellow start
- `colors.dark: "#df91f7"` — magenta end
- `appearance.default: "dark"` — dark by default
- `fonts.heading/body: Geist` — matches the marketing site
- `fonts.code: JetBrains Mono` — matches the marketing site code blocks
- `styling.codeblocks.theme: github-dark`

If a future Mintlify release adds finer typography controls, revisit the `fonts`
block to load Geist + JetBrains Mono via woff2 from Google Fonts directly.

## OpenAPI

The API Reference tab in `docs.json` points at the live served spec
`https://api.pegana.xyz/openapi.json`, which is generated from `utoipa`
annotations on the axum handlers. Mintlify renders it as live, testable API
documentation with code samples in multiple languages.

When the Rust API changes, update the `#[utoipa::path]` / `#[derive(ToSchema)]`
annotations and redeploy the API — the served spec regenerates automatically
(coverage is CI-pinned by the `openapi_paths_cover_every_router_handler` test).
The old hand-written `api-reference/openapi.yaml` has been removed.

## Content guidelines

- **Match the marketing-site tone.** Technical, dense, no marketing fluff.
- **Mono for data, sans for prose.** Pegana's brand convention.
- **No emoji except in functional decorators** (state pips: 🟢🟠🔴 only in places
  where colored dots are the right semantic).
- **Cite sources.** Every concept and case study has a "Sources" footer.
- **Cross-link.** Every page ends with 1–4 `<Card>` links to the natural next read.

## Adding a concept or guide

1. Create `concepts/<slug>.mdx` (or `guides/<slug>.mdx`)
2. Add frontmatter: `title`, `description`
3. Add the path to `docs.json` → `navigation.tabs[].groups[].pages`
4. Reload `mintlify dev`

## Contact

Issues / suggestions: [github.com/PeganaHQ/Pegana/issues](https://github.com/PeganaHQ/Pegana/issues)
Operator: `rafael@pegana.xyz`
