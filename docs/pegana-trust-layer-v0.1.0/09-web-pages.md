> ⚠️ **AMENDED** — see [`AMENDMENTS.md`](AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original spec preserved below as historical reference.

---

# 09 — Web Pages

> All new web routes in `web/` (Next.js 16 App Router). Includes audit pages, methodology page (fresh build), pricing waitlist, agents showcase, embed surfaces, and OG image generation.

---

## 1. Route inventory

| Route | File | Purpose |
|---|---|---|
| `/audit/[alert_id]` | `app/audit/[alert_id]/page.tsx` | Receipt renderer (6 sections) |
| `/audit/[alert_id]/loading.tsx` | same dir | Skeleton during API call |
| `/audit/[alert_id]/not-found.tsx` | same dir | 404 for `evidence_missing` |
| `/audit/[alert_id]/opengraph-image.tsx` | same dir | Dynamic 1200×630 OG card |
| `/audit` | `app/audit/page.tsx` | Index of recent audits (table) |
| `/methodology` | `app/methodology/page.tsx` | Fresh build — CHANGELOG renders, install snippet |
| `/pricing` | `app/pricing/page.tsx` | Waitlist (no active tiers) |
| `/agents` | `app/agents/page.tsx` | MCP showcase + verify_alert demo |
| `/embed/[asset]` | `app/embed/[asset]/page.tsx` | Iframe variant of embed widget |
| `/embed/demo` | `app/embed/demo/page.tsx` | Partner integration showcase |
| `/audit.xml` | `app/audit.xml/route.ts` | Atom 1.0 feed |
| `/calibration.xml` | `app/calibration.xml/route.ts` | Atom 1.0 feed from git log |

Plus modifications:
- `app/layout.tsx` — `<link rel="alternate" type="application/atom+xml">` discovery
- `app/(marketing)/page.tsx` — trust strip with `assets_in_drift` live count

---

## 2. Routing decisions

**Top-level placement** (NOT under `(app)` or `(marketing)` groups):
- `/audit/*` — public, indexable, factual proof surface
- `/methodology` — public, indexable, no marketing chrome
- `/embed/*` — utility, sandboxed
- `/agents` — under `(marketing)` if it fits as ecosystem showcase; else top-level

**Why split**: `(app)` group typically has auth/dashboard chrome (sidebar, user nav). `(marketing)` has hero + footer + brand. Audit/methodology need NEITHER — they're standalone trust artifacts. Easier to grep + maintain.

---

## 3. `/audit/[alert_id]` — receipt detail page

Server component. Fetches `${API_BASE}/v1/audit/[alert_id]` with `next: { revalidate: 60 }` (receipts are immutable so could be `revalidate: 31536000`, but 60s gives a window to recover from accidental cache poisoning).

**6 sections rendered**:

1. **Header**: asset, class badge, state transition (`PEGGED → DRIFT`), `detected_at` timestamp (humanized + ISO)
2. **Inputs (frozen)**: table of `intrinsic_usd`, `market_usd`, optional `intrinsic_sol`/`market_sol`, `ewma_prev`, Pyth entries (price ± confidence + publish_time with "as of N seconds ago"), `thresholds` map
3. **Computed**: `discount_raw`, `discount_smooth`, `final_state`, `confidence_label`
4. **Methodology**: `version` (linking to git tag), `git_sha` (linking to commit), `assets_toml_sha256` (linking to GitHub blob view at that hash), lifecycle status badge (active/deprecated/broken — banner if broken)
5. **Replay**: "Download replay bundle" button (`/v1/audit/:alert_id/replay-bundle`) — only shown if `has_replay_artifact`. Command snippet `pegana-replay --alert-id <UUID>` and `--verify-onchain`. Link to "How to verify" on `/methodology`
6. **On-chain commitment**: shown only if `onchain_tx_sig` present. Solscan URL link. "Verify in your wallet" snippet for `pegana-replay --verify-onchain`

**Disclaimer** (per `01-business-rules.md § 10`) at footer:
> Pegana is a verifiable computation log. Not SOC 2, not regulatory audit, not financial advice.

**Reference template** in monolithic spec (already validated). See `web/app/audit/[alert_id]/page.tsx` task detail in `plans/09-phase-10-web-pages.md`.

---

## 4. `/audit/[alert_id]/loading.tsx`

Minimal skeleton — animated zinc blocks matching the 6 section layout. Renders if `fetch` exceeds default Next.js timeout (default ~10s).

---

## 5. `/audit/[alert_id]/not-found.tsx`

404 dedicated to "evidence_missing" — distinct from generic 404 because the URL itself was valid (UUID format ok) but the audit ledger has nothing.

Message: "This alert ID isn't in our public ledger. It may have predated the trust layer, or the URL may be incorrect." Link back to `/`.

---

## 6. `/audit/[alert_id]/opengraph-image.tsx` — dynamic OG card

Next.js 16 file convention. Renders 1200×630 PNG with `next/og` `ImageResponse`.

Layout: asset symbol (large), transition badge (PEGGED → CRITICAL), methodology version, first 12 chars of receipt sha256, Pegana brand mark.

```tsx
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const API_BASE = process.env.PEGANA_API ?? "https://api.pegana.xyz";
export const alt = "Pegana audit receipt";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ alert_id: string }> }) {
  const { alert_id } = await params;
  const data = await fetch(`${API_BASE}/v1/audit/${alert_id}`).then((r) => r.json()).catch(() => ({
    alert: { asset: "?", from_state: "?", to_state: "?", detected_at: "" },
    evidence: { methodology_version: "?", receipt_sha256: "?" },
  }));
  const fontData = await readFile(join(process.cwd(), "assets/Inter-Bold.ttf"));

  return new ImageResponse(
    (
      <div style={{
        width: "100%", height: "100%",
        background: "linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%)",
        color: "white", padding: "60px",
        display: "flex", flexDirection: "column", justifyContent: "space-between",
        fontFamily: "Inter",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 24, color: "#888" }}>PEGANA · AUDIT RECEIPT</div>
          <div style={{ fontSize: 18, color: "#666" }}>v{data.evidence.methodology_version}</div>
        </div>
        <div>
          <div style={{ fontSize: 96, fontWeight: 700, lineHeight: 1 }}>{data.alert.asset}</div>
          <div style={{ marginTop: 24, fontSize: 48, display: "flex", alignItems: "center", gap: 24 }}>
            <span style={{ background: "#2a2a2a", padding: "8px 24px", borderRadius: 8 }}>
              {data.alert.from_state}
            </span>
            <span style={{ color: "#888" }}>→</span>
            <span style={{ background: "#7c2d12", padding: "8px 24px", borderRadius: 8 }}>
              {data.alert.to_state}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 20, color: "#666" }}>
          <div>sha256:{data.evidence.receipt_sha256.slice(0, 12)}</div>
          <div>verify at pegana.xyz/methodology</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [{ name: "Inter", data: fontData, style: "normal", weight: 700 }],
    },
  );
}
```

**Asset**: requires `web/assets/Inter-Bold.ttf` (download from Google Fonts if missing).

---

## 7. `/audit` — index page

Server component. Fetches `/v1/audit?limit=50&exclude_pegged=true` with `revalidate: 60`.

Table columns: When (UTC), Asset (link to `/audit/[id]`), Transition badge, Methodology version, Receipt fingerprint (first 12 chars).

Methodology version filter via query string `?methodology_version=0.1.0`.

Footer: "Subscribe to Atom feed" link to `/audit.xml`; "Programmatic access: `GET /v1/audit?limit=50`" snippet.

---

## 8. `/methodology` — fresh build

Server component. Reads `crates/methodology/CHANGELOG.md` via `fs.readFile` at build time (no revalidation needed — changelog updates on PR merge, web redeploys).

**6 sections**:
1. **What this is** — short paragraph defining the methodology
2. **One-liner**: "Oracle/intrinsic + executable market quote = spread."
3. **Verify any alert** — install snippet (`curl ... | sh`), `pegana-replay --alert-id <UUID>` command, `gh attestation verify` for binary provenance
4. **Version lifecycle** — `active|deprecated|broken` explained
5. **Changelog** — rendered from CHANGELOG.md
6. **Asset coverage status** — link to live table at `/methodology#asset-status`
7. **What this ISN'T** — explicit disclaimer

Anchor links: `#changelog`, `#lifecycle`, `#asset-status`, `#binary-checksums`, `#on-chain-anchor`.

---

## 9. `/pricing` — waitlist (no active tiers)

Per `01-business-rules.md § 7`, pricing tiers do NOT activate in v0.1.0. This page is a waitlist signup with disclosure: "Free now. Pro/Realtime in development — join the list."

Components:
- Hero: "Pegana is free during alpha. Pro/Realtime/Enterprise tiers in development."
- Tier preview cards (Free, Pro, Realtime, Enterprise) with "coming soon" / "join waitlist" CTAs
- Waitlist form (email + use case dropdown)
- Disclosure: "We will NOT charge until calibration v1 publishes p95/p99 latency metrics and we have at least 1 design partner signed."

Form submissions persist to Postgres `pricing_waitlist` table (new in this release):
```sql
-- migrations/0032_pricing_waitlist.sql (optional, defer if scope tight)
CREATE TABLE pricing_waitlist (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT        NOT NULL UNIQUE,
    use_case    TEXT,
    tier_interest TEXT[],
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Acceptance**: page renders, form submits, no active tier prices shown. AC44.

---

## 10. `/agents` — MCP showcase

Server component. Shows:
- MCP server URL (`https://mcp.pegana.xyz`)
- List of free tools (`get_assets`, `get_asset_state`, `verify_alert`, `get_methodology`) and paid tools (`subscribe_peg_events`, `get_asset_history`)
- Code snippet: `verify_alert(alert_id)` call from TypeScript using MCP client
- Live demo: paste an alert UUID, get receipt back (calls `/v1/audit/:id` via web fetch)
- Sample agent integration: "Agent receives a peg-state change alert via webhook → calls verify_alert MCP tool → decides to de-allocate from DRIFT/DEPEG asset."

Pitches the angle to SendAI / agent builders. Critical for solana.new submission (Phase 13.5).

---

## 11. `/embed/[asset]` and `/embed/demo`

Already covered in `08-external-surfaces.md § Embed widget`. Iframe variant is a server component. Demo page shows both variants live + integration snippets.

---

## 12. `/audit.xml` and `/calibration.xml` — Atom feeds

Both use Next.js Route Handlers (`route.ts`) returning XML with `Content-Type: application/atom+xml; charset=utf-8`.

`/audit.xml`:
- Source: `/v1/audit?limit=50&exclude_pegged=true`
- Cache: `s-maxage=60, stale-while-revalidate=300`
- `feed` npm package handles Atom 1.0 serialization

`/calibration.xml`:
- Source: `git log --follow assets.toml -p -n 100` (executed via `execSync` in Route Handler)
- Filtered to commits touching `thresholds_(bps|cr)` or asset row add/remove
- Each commit becomes an Atom entry with diff preview + GitHub commit link
- Cache: `s-maxage=3600, stale-while-revalidate=7200`

Discovery: `<link rel="alternate" type="application/atom+xml">` for both in `app/layout.tsx`.

---

## 13. Home page trust strip — `app/(marketing)/page.tsx`

Patch existing home page to surface `assets_in_drift` live count (already exposed in `/v1/stats` per prior session's commit).

```tsx
// existing imports + components

import { useStats } from "@/lib/hooks/useStats";

export default function Home() {
  const { stats } = useStats();  // SWR hook, refresh 30s
  const driftCount = stats?.assets_in_drift ?? 0;

  return (
    <>
      {/* existing hero, etc. */}
      <div className="border-y border-zinc-200 bg-zinc-50 py-3">
        <div className="mx-auto max-w-7xl px-4 flex items-center justify-between">
          <div className="text-sm">
            <span className="font-semibold text-amber-600">{driftCount}</span>
            {" "}
            <span className="text-zinc-600">
              {driftCount === 1 ? "asset" : "assets"} in DRIFT right now
            </span>
          </div>
          <a className="text-sm underline" href="/audit">view live audits →</a>
        </div>
      </div>
      {/* rest of page */}
    </>
  );
}
```

If `useStats` hook doesn't exist, create it in `web/lib/hooks/useStats.ts` calling `/v1/stats` with SWR 30s revalidation.

---

## 14. Disclaimers (cross-cutting)

Per `01-business-rules.md § 10`, the standard disclaimer renders on:
- `/methodology` § "What this isn't"
- `/audit/[alert_id]` footer
- `/audit` footer
- `/embed/[asset]` (compact: "Pegana ↗" link is sufficient — full page has disclaimer)
- `/agents` (in description of trust posture)

Bot `/help` command also outputs the disclaimer text once.

---

## 15. Test plan

- E2E with Playwright: visit `/audit/<real-prod-uuid>`, verify 6 sections render. Visit `/audit/<garbage-uuid>`, verify `evidence_missing` 404 page.
- OG image: pass URL through Twitter Card Validator + Telegram preview.
- `/audit.xml`: feedvalidator.org check.
- `/calibration.xml`: hand-validate after a known `assets.toml` mutation.
- Home page trust strip: change a threshold in staging to trigger DRIFT, verify count updates within 30s.

---

## 16. Cross-references

- For the API endpoints these pages consume, see `07-api-surface.md`.
- For embed widget script (`/embed.js`), see `08-external-surfaces.md`.
- For tasks, see `plans/09-phase-10-web-pages.md` and `plans/10-phase-11-lifecycle-index-og.md`.
- For acceptance criteria AC38-AC47, AC86-AC88, see `12-acceptance-criteria.md § Web pages`.
