# Execution sprint 2026-05-25 — positioning, runbooks, R1 drift detection

> Branch: `worktree-exec-sprint-2026-05-25` · 9 commits · 21 files · +1852 / -1
> Rebased clean onto current `main`. `cargo check --workspace --all-targets`
> green. 10 new unit tests passing.

This PR is the execution half of a multi-step analysis sprint
(competitive landscape, code deep-dive, market research). It ships the
code/docs work that doesn't require external credentials. Action items
that DO need credentials are listed at the bottom.

---

## Summary by trail

### 🤖 Bot

- **`e16fa35` feat(bot): private-beta banner on /start while FEATURE_PUBLIC_ALERTS=false**
  Anyone who finds `@PeganaWatchBot` today and types `/start` gets the
  welcome message and then a second message explaining the calibration
  phase so they don't conclude the bot is broken. The banner
  disappears automatically when the flag flips to `true`. EN + pt-BR.

### 🌐 Web — positioning

Pegana's hackathon cluster (Solana Data and Monitoring Infrastructure,
257 projects on Colosseum) has **0 historical winners**. Judges reward
primitives, not dashboards. Reframing Pegana as the *peg-risk oracle
other protocols consume* opens an audience that does reward
observability.

- **`7792809` feat(positioning): metadata + about**
  Layout description now leads with "the peg-risk oracle for Solana"
  and surfaces the public REST + WS. About page gains one paragraph
  explaining who else consumes Pegana (insurance, prediction markets,
  lending) and links to `/oracle`. Hero / landing / brand untouched.

- **`5605c8b` feat(web): /oracle page**
  New marketing route positioning Pegana for protocol consumers.
  Sections: tagline · 3 named use cases · REST endpoints (mirrors
  the real axum routes) · WebSocket snippet · commitments table ·
  integration CTA.

- **`0c7d582` feat(web): /vs-stableguard comparison page**
  Honest comparison page covering the global direct competitor that
  surfaced in the market research (`stableguard.org` — different from
  the Solana hackathon project of the same name). Owns the search
  query, calls out what StableGuard does better, lists where we
  overlap (USDC + USDT) and where we don't (LSTs, yield-bearing NAV,
  Hylo CDP).

### 📚 Web — SEO content

- **`fb86a05` feat(web): /concepts route with 3 reference posts**
  Reference posts on the concepts Pegana measures — none have a clean
  reference page in the Solana ecosystem today.
  - `/concepts/lst-peg-drift` — Sanctum sol_value, market vs intrinsic,
    calibrated thresholds, cross-link to the mSOL flash-crash
    post-mortem
  - `/concepts/yield-bearing-nav-oracles` — Pyth Redemption Rate,
    Token-2022 InterestBearing, NAV-vs-market formula, per-asset
    liquidity caveats
  - `/concepts/hylo-cdp-cr-signal` — CR as leading indicator, IDL drift
    risk, all 5 Hylo assets
  New `/concepts/[slug]` route + index; separate from the design-locked
  `/learn` post-mortem route.

### 📋 Runbooks

- **`03099fd` docs(runbook): vercel-root-404.md**
  Diagnoses the live bug at `www.pegana.xyz/` (root returns Next's
  not-found body despite every other route serving 200). Documents
  what's NOT wrong (verified) and provides a 5-step fix sequence
  starting with `cd web && vercel --prod`.

- **`cda3193` docs(runbook): deploy-day.md**
  Wraps the existing `docs/ops/deploy-hetzner.md` with a pre-flight
  checklist (code green, secrets in vault, bot dogfood smoke), step
  table with time budgets, 8-curl post-deploy smoke checklist,
  10-minute emergency rollback, and a "don't do these on deploy day"
  list (don't flip public alerts, don't touch Vercel in parallel,
  don't tweet for 24h).

### 📨 Outreach

- **`040b248` docs(outreach): 7 integration-target drafts (EN + pt-BR)**
  Each draft ≤ 150 words with one yes/no ask. README orders them
  warmest → coldest:
  1. parity-fi (Cypherpunk prediction-market — they need an oracle)
  2. stableguard-solana-hackathon (insurance — needs depeg event source)
  3. drift (post-$270M-exploit, risk-monitoring sensitivity is up)
  4. marginfi (biggest LST-collateral lender)
  5. kamino (leveraged LST strategy vaults)
  6. stableguard-org (the live dashboard — partnership / data swap)
  7. chaos-labs (awareness only — they're 100× our size)
  Includes a "what NOT to do" guard so outreach doesn't go out before
  the bot is queue-able and the `/` is fixed.

### 🛡️ Risk register

- **`3a0cd57` feat(indexer/hylo): R1 drift detection via input sanity checks**
  Original R1 was "Hylo IDL decode breaks on V2 upgrade." Current
  architecture doesn't decode IDL — it uses DefiLlama TVL + on-chain
  mint supplies + hand-rolled PDA derivation. So R1 in the current
  shape surfaces as DefiLlama drift, PDA seed drift, or mint
  migration.
  `check_hylo_inputs()` runs every poll. Eight named checks, each
  emits `pegana_hylo_sanity_failure_total{check="..."}` so alertmanager
  can fire on any one independently. Pure function. 10 unit tests
  covering happy path + each failure mode + zero-CR-skipped boot guard.

---

## What this PR does NOT change

- Hero / landing / dashboard visuals (design-locked; out of scope)
- `(marketing)/page.tsx` itself (root-404 fix is `vercel --prod`,
  not a code change — see runbook)
- Hetzner provisioning (requires credentials)
- DNS (requires Cloudflare access)
- Bot's existing 11 commands beyond `/start` (Tasks B5/B6/B7 in
  `project_bot_state.md` are still deferred)

---

## Verification

```bash
cd <repo>
cargo check --workspace --all-targets       # ✅ clean
cargo test --manifest-path .claude/worktrees/exec-sprint-2026-05-25/crates/indexer-rs/Cargo.toml sources::hylo
# 10 passed; 0 failed
```

Web typecheck not run locally because the worktree's `node_modules`
isn't installed — runs as a no-op in CI on push.

---

## Action items for the user (require credentials this branch can't carry)

In priority order. Branch should be merged before doing these.

1. **Push the branch + redeploy Vercel** (~10 min)
   ```bash
   git push origin worktree-exec-sprint-2026-05-25
   gh pr create  # or merge via UI
   cd web && vercel --prod
   ```
   The Vercel redeploy is what fixes the live `/` 404 (per the runbook).

2. **Provision Hetzner + first boot** (~2 hours)
   Follow `docs/runbooks/deploy-day.md` checklist top-to-bottom,
   which links into `docs/ops/deploy-hetzner.md` for actual commands.

3. **Start 14-day dogfood** (passive)
   Once Hetzner is up with the bot in dogfood mode, the calibration
   window starts. Daily review of false-positive count.

4. **Stagger the outreach** (2 per day max, not before #1 and #2 are
   green). Send order in `docs/outreach/README.md`.

5. **Flip `FEATURE_PUBLIC_ALERTS=true`** only after dogfood passes
   (per the deploy-day "don't do these" list).

---

## Memory updates

Two new memory entries for future-session context:
- `memory/project_competitive_landscape.md` — updated with the
  stableguard.org direct-competitor discovery
- `memory/project_vercel_root_404.md` — new entry capturing the bug
  scope (only `/`, not the site) and the fix path

🤖 Generated with [Claude Code](https://claude.com/claude-code)
