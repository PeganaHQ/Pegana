# Mintlify deploy — Custom domain strategy

> Updated 2026-08-03 — docs now live at `docs.pegana.xyz` (Mintlify custom domain).
> The previous Vercel-proxy approach (`/docs` rewrite to `pegana.mintlify.dev`)
> was retired in favour of a dedicated subdomain.

## Architecture

```
visitor → https://docs.pegana.xyz/guides/rest-api
        → Mintlify (custom domain, CNAME → cname.mintlify.builders.)
        → Mintlify serves the built page
        → browser URL stays docs.pegana.xyz/...
```

Legacy `/docs/*` paths on `www.pegana.xyz` and `pegana.xyz` permanently redirect
to `https://docs.pegana.xyz/*` via `web/vercel.json`.

## Steps

### 1. Mintlify account + GitHub install (manual)

1. Create a Mintlify account at <https://mintlify.com>.
2. Install the **Mintlify GitHub app** on the repo. Limit access to that repo only.
3. In the Mintlify dashboard → **New Project** → connect the repo → point at
   the `docs-site/` directory. Mintlify detects `docs-site/docs.json` and
   starts building.

### 2. Connect custom domain (manual)

1. Mintlify dashboard → **Settings** → **Domains** → add `docs.pegana.xyz`.
2. Set `docs.pegana.xyz` as the **Primary/Canonical** domain.
3. DNS (Cloudflare): `docs.pegana.xyz CNAME cname.mintlify.builders.`
4. Allow ~15 minutes for cert provisioning.

### 3. Deploy the web app + verify

```sh
vercel --prod   # from web/
```

After the deploy lands:

```sh
CURL=/usr/bin/curl
# Redirects (no -L, verify 308 + Location)
$CURL -sS -o /dev/null -D - https://www.pegana.xyz/docs
$CURL -sS -o /dev/null -D - https://www.pegana.xyz/docs/guides/rest-api
# Final docs pages (200)
$CURL -sS -o /dev/null -w "%{http_code}\n" -L https://docs.pegana.xyz
$CURL -sS -o /dev/null -w "%{http_code}\n" -L https://docs.pegana.xyz/guides/rest-api
$CURL -sS -o /dev/null -w "%{http_code}\n" -L https://docs.pegana.xyz/concepts/peg-risk-101
```

### 4. Eyeball checks

- Nav tree renders (Get Started → Concepts → Methodology → Guides → Case
  Studies → Resources, plus API Reference tab)
- API Reference tab loads OpenAPI from the live `https://api.pegana.xyz/openapi.json` URL
- Logo (light/dark) renders
- Dark theme is default
- Code blocks use the dark GitHub theme
- Search works (`Cmd-K`)
- Canonical tags emit `https://docs.pegana.xyz/...` (not `www` or `mintlify.dev`)

### 5. OpenAPI update workflow (unchanged)

When the Rust API changes:

1. Add or update utoipa annotations in the relevant axum handler.
2. Confirm `https://api.pegana.xyz/openapi.json` includes the changed path
   after deploy.
3. Commit + push to `main`.
4. Mintlify reads the live `openapi.json` URL configured in `docs-site/docs.json`
   **at build time only**. A push triggers a build, but the backend deploy
   (`scripts/deploy.sh`) usually lands after it, so that build still renders the
   old spec. After every API deploy that changes the spec, trigger a manual
   rebuild of the latest commit from the Mintlify dashboard and confirm the API Reference tab shows the new text. The 2026-10-21
   audit found the tab still describing `GET /v1/alerts` weeks after the route
   was removed.

### 6. Check pages before pushing

Mintlify keeps serving the last good build of a page whose MDX does not parse,
with no visible error. CI (`docs-site` job in `.github/workflows/ci.yml`) runs
the same check; to run it locally:

```sh
mkdir -p /tmp/docs-check && cp scripts/check-docs-site.mjs /tmp/docs-check/
npm install --prefix /tmp/docs-check --no-audit --no-fund @mdx-js/mdx@3.1.1 remark-gfm@4.0.1
node /tmp/docs-check/check-docs-site.mjs docs-site   # from the repo root
```

## Failure modes to watch for after deploy

- **`docs.pegana.xyz` returns 404 / DEPLOYMENT_NOT_FOUND** → DNS CNAME not
  propagated yet, or Mintlify custom domain not connected. Check
  `dig docs.pegana.xyz` resolves to `cname.mintlify.builders`.
- **Canonical tags still point to `www.pegana.xyz`** → Mintlify primary domain
  not set to `docs.pegana.xyz`. Fix in dashboard → **Settings** → **Domains**.
- **`/docs` returns 404 on `www.pegana.xyz`** → Vercel redirects not deployed.
  Confirm `vercel --prod` ran and `vercel.json` has the `/docs` redirects.

## Rollback

If `docs.pegana.xyz` becomes unavailable, first verify that the upstream
`https://pegana.mintlify.dev` still serves the site at its root. Then replace
only the two `/docs` redirects in `web/vercel.json` with these rewrites, keeping
the existing schema, framework, and apex-to-www redirect intact:

```json
"rewrites": [
  { "source": "/docs",          "destination": "https://pegana.mintlify.dev" },
  { "source": "/docs/:match*",  "destination": "https://pegana.mintlify.dev/:match*" }
]
```

Revert active links to `/docs` in the same rollback commit. DNS and Mintlify
custom-domain changes remain operator-controlled and must be rolled back
together.

---

## Historical: Vercel proxy approach (retired 2026-08-03)

The previous architecture (2026-05-29 → 2026-08-03) proxied Mintlify under
`pegana.xyz/docs` via Vercel rewrites. It was adopted after the original
`docs.pegana.xyz` CNAME→`cname.mintlify.app` plan returned
`DEPLOYMENT_NOT_FOUND` for weeks. The path-prefix proxy solved that failure mode
at the time, but was retired when the custom domain was successfully connected
with the correct CNAME target (`cname.mintlify.builders`).
