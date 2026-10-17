# Docs Canonical-Domain Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `https://docs.pegana.xyz` the sole canonical docs origin and permanently redirect all active legacy docs routes to it.

**Architecture:** Mintlify serves the docs subdomain directly. Vercel stops proxying Mintlify under `/docs` and instead owns permanent compatibility redirects; active code and metadata link directly to the docs subdomain. Historical evidence keeps its recorded URLs.

**Tech Stack:** Mintlify, Vercel routing, Next.js 16, TypeScript, Vitest, Playwright, Bun.

---

### Task 1: Lock redirect behavior with tests

**Files:**
- Create: `web/vercel-config.test.ts`
- Create: `web/next-config.test.ts`
- Modify: `web/proxy.test.ts`
- Modify: `web/app/llms.txt/route.test.ts`

- [ ] Add tests asserting no `/docs` rewrite exists, exact and wildcard permanent redirects target `https://docs.pegana.xyz`, and those redirects precede the apex catch-all.
- [ ] Add tests asserting all legacy Next redirects use absolute docs-subdomain destinations and remain permanent.
- [ ] Update proxy matcher tests to remove the obsolete Mintlify-proxy exclusion.
- [ ] Add llms route assertions for `https://docs.pegana.xyz` and rejection of both old `/docs` absolute origins.
- [ ] Run `bun run test -- vercel-config.test.ts next-config.test.ts proxy.test.ts app/llms.txt/route.test.ts` from `web/` and confirm the new tests fail for the current proxy architecture.

### Task 2: Replace the `/docs` proxy with permanent redirects

**Files:**
- Modify: `web/vercel.json`
- Modify: `web/next.config.ts`
- Modify: `web/proxy.ts`

- [ ] Remove the Mintlify rewrite block from `vercel.json`.
- [ ] Add permanent exact and wildcard `/docs` redirects to the docs subdomain before the apex catch-all.
- [ ] Replace relative `DOCS_BASE` destinations in `next.config.ts` with absolute `https://docs.pegana.xyz` destinations.
- [ ] Remove the obsolete docs exclusion and proxy explanation from `proxy.ts`.
- [ ] Re-run the focused tests and confirm they pass.

### Task 3: Update active web links and machine discovery

**Files:**
- Modify: `web/components/organisms/app-footer.tsx`
- Modify: `web/components/organisms/v2/footer-v2.tsx`
- Modify: `web/components/organisms/v2/nav-v2.tsx`
- Modify: `web/components/organisms/v2/hero-v2.tsx`
- Modify: `web/components/organisms/v2/close-v2.tsx`
- Modify: `web/components/molecules/mobile-menu.tsx`
- Modify: `web/app/(marketing)/lst/page.tsx`
- Modify: `web/app/(marketing)/faq/page.tsx`
- Modify: `web/app/(app)/account/webhooks/page.tsx`
- Modify: `web/lib/llms/pages.ts`
- Modify: `web/app/llms.txt/route.ts`
- Modify: `web/app/layout.tsx`

- [ ] Replace active `/docs` hrefs with absolute docs-subdomain URLs.
- [ ] Remove proxy-only prefetch workarounds and stale comments.
- [ ] Ensure generated llms indexes advertise both docs root and docs-hosted `llms.txt`.
- [ ] Run focused llms and affected component tests.

### Task 4: Update SDK and current documentation metadata

**Files:**
- Modify: `sdk/typescript/package.json`
- Modify: `sdk/typescript/README.md`
- Modify: `sdk/python/pyproject.toml`
- Modify: `sdk/python/README.md`
- Modify: `docs-site/docs.json`
- Modify: `docs-site/README.md`
- Modify: `docs-site/DEPLOY.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/CHANGELOG-V2.md`
- Modify: `docs/guides/consume-the-peg-feed.md`
- Modify: `docs/launch/screenshots.md`

- [ ] Replace active current public docs URLs with `https://docs.pegana.xyz` while preserving dated historical evidence.
- [ ] Rewrite deployment instructions to describe direct Mintlify custom-domain hosting and legacy external redirects.
- [ ] Update SDK registry metadata to the direct docs homepage.
- [ ] Validate `docs-site/docs.json` remains valid JSON.

### Task 5: Configure and verify Mintlify

**Files:**
- Mintlify deployment setting and generated site state; no repository file required unless `docs.json` changes.

- [ ] Read custom-domain deployment state through Mintlify MCP when available.
- [ ] Ensure `docs.pegana.xyz` is connected at root base path.
- [ ] Verify representative pages emit canonical tags on `https://docs.pegana.xyz/...`.
- [ ] If Mintlify still emits `www`, correct the deployment custom-domain configuration through MCP or dashboard and wait for propagation.

### Task 6: Full verification

**Files:**
- No additional implementation files.

- [ ] Run `bun run typecheck`, `bun run lint`, and `bun run test` from `web/`.
- [ ] Run `bun run typecheck`, `bun run lint`, and `bun run test` from `sdk/typescript/` when scripts exist; otherwise run package-specific available checks.
- [ ] Validate Python package metadata/build tooling available in `sdk/python/`.
- [ ] Search active source scopes for forbidden `https://pegana.xyz/docs` and `https://www.pegana.xyz/docs` references, excluding historical evidence.
- [ ] Inspect `git diff` and `git status` for unintended changes.

### Task 7: Ship and production verification

**Files:**
- Commit all intended repository files.

- [ ] Commit explicit paths with a concise repository-style message.
- [ ] Push `main` to trigger the Vercel deployment.
- [ ] Poll until `www /docs` exact and nested paths permanently redirect to matching docs-subdomain paths.
- [ ] Confirm docs root, introduction, REST guide, and `llms.txt` return successful responses.
- [ ] Confirm rendered canonical tags use the docs subdomain.
- [ ] Confirm `www.pegana.xyz` remains the web app and apex non-doc paths still redirect to `www`.
