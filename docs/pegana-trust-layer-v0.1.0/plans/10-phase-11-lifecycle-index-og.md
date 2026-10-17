> ⚠️ **AMENDED** — see [`../AMENDMENTS.md`](../AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original plan preserved below as historical reference.

---

# Phase 11 — Methodology Lifecycle + /audit Index + OG Images + /methodology + /pricing + /agents

**Spec reference**: `../04-data-model.md § Migration 0030`, `../09-web-pages.md`
**Acceptance criteria covered**: AC41-AC47
**Dependencies**: Phase 3 (migration 0030 applied), Phase 10 (audit page structure)
**Estimated duration**: 2-3 days

---

## Overview

6 tasks across spec sections. Methodology lifecycle table + engine startup refusal-to-start. New `/audit` index. Dynamic OG card per receipt. Fresh `/methodology` page. NEW: `/pricing` waitlist + `/agents` MCP showcase (from prior strategic session P0/P1).

---

## Task 11.1 — methodology_versions runtime check

**NOTE**: Migration 0030 + engine startup check was already implemented as part of Phase 3 (Task 3.5). This task is now just **verification + lifecycle docs**.

**Files**: none new (verify existing implementation)

- [ ] **Step 1**: Verify engine startup check works

On staging, insert a synthetic broken row:

```sql
INSERT INTO methodology_versions VALUES ('0.0.99', 'methodology-v0.0.99', NOW(), 'broken', 'test', NULL, NULL);
```

Then temporarily build engine with `CARGO_PKG_VERSION=0.0.99` (or set env override). Restart engine. Expected: engine exits with error, doesn't start.

Rollback:

```sql
DELETE FROM methodology_versions WHERE version = '0.0.99';
```

- [ ] **Step 2**: Document broken-version recovery procedure

Append to `docs/operations/methodology-lifecycle.md` (new):

```markdown
# Methodology version lifecycle — operational procedures

## Marking a version broken (operator runbook)

When a methodology bug is confirmed:

1. Identify the broken version: `SELECT version FROM methodology_versions WHERE status = 'active';`
2. Reproduce the bug via test in `crates/methodology/tests/`.
3. Develop fix in `crates/methodology/src/` + bump version (e.g. 0.1.0 → 0.1.1).
4. Build + deploy engine with new version.
5. Once new version is running, mark old broken:
   ```sql
   INSERT INTO methodology_versions VALUES ('0.1.1', 'methodology-v0.1.1', NOW(), 'active', NULL, NULL, '<reason>');
   UPDATE methodology_versions SET status='broken', status_reason='<bug description>', superseded_by='0.1.1' WHERE version='0.1.0';
   ```
6. Past alerts emitted by 0.1.0 will show a warning banner on `/audit/[id]`.

## Why this matters

Engine refuses to start on a broken version (prevents continued emission of bad alerts).
Past receipts stay queryable + replayable (records aren't deleted).
Audit page UI surfaces lifecycle status to readers.
```

- [ ] **Step 3**: Commit operational doc

```bash
git add docs/operations/methodology-lifecycle.md
git commit -m "$(cat <<'EOF'
docs(ops): methodology version lifecycle procedures

Documents the broken-version recovery flow. Engine refuse-to-start
mechanism implemented in Phase 3 (Task 3.5).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11.2 — /audit index page + /v1/audit endpoint reuse

**Files**:
- Create: `web/app/audit/page.tsx`
- (Reuses `/v1/audit` endpoint already implemented in Phase 4)

- [ ] **Step 1**: Write the index page

```tsx
// web/app/audit/page.tsx
const API_BASE = process.env.PEGANA_API ?? "https://api.pegana.xyz";

type IndexRow = {
  id: string;
  asset: string;
  from_state: string;
  to_state: string;
  detected_at: string;
  methodology_version: string;
  receipt_sha256: string;
  onchain_tx_sig: string | null;
};

async function fetchIndex(): Promise<IndexRow[]> {
  const resp = await fetch(`${API_BASE}/v1/audit?limit=50&exclude_pegged=true`, {
    next: { revalidate: 60 },
  });
  if (!resp.ok) throw new Error(`API ${resp.status}`);
  return resp.json();
}

export const metadata = {
  title: "Recent audits · Pegana",
  description: "Browse the most recent verifiable peg-risk alerts from Pegana.",
};

export default async function AuditIndexPage() {
  const rows = await fetchIndex();
  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-wider text-zinc-500">Recent audits</p>
        <h1 className="mt-2 text-3xl font-semibold">Last 50 non-pegged alerts</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Every Pegana alert ships with an audit receipt. Click any row to inspect
          inputs, computed outputs, and the methodology version that produced it.
        </p>
      </header>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wider text-zinc-500">
            <th className="py-3">When (UTC)</th>
            <th>Asset</th>
            <th>Transition</th>
            <th>Methodology</th>
            <th>Receipt</th>
            <th>On-chain</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-zinc-100">
              <td className="py-3 font-mono text-xs">
                {new Date(r.detected_at).toISOString().replace("T", " ").slice(0, 19)}
              </td>
              <td>
                <a className="font-semibold text-emerald-700 underline" href={`/audit/${r.id}`}>
                  {r.asset}
                </a>
              </td>
              <td>
                <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs">{r.from_state}</span>
                <span className="mx-1 text-zinc-400">→</span>
                <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium">{r.to_state}</span>
              </td>
              <td><code className="text-xs">v{r.methodology_version}</code></td>
              <td><code className="text-xs text-zinc-500">{r.receipt_sha256.slice(0, 12)}…</code></td>
              <td>
                {r.onchain_tx_sig ? (
                  <a
                    href={`https://solscan.io/tx/${r.onchain_tx_sig}`}
                    className="text-xs text-emerald-600 underline"
                  >
                    ✓
                  </a>
                ) : (
                  <span className="text-xs text-zinc-400">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-8 text-xs text-zinc-500">
        For programmatic access: <code>{`GET ${API_BASE}/v1/audit?limit=50`}</code>
        {" · "}<a className="underline" href="/audit.xml">Atom feed</a>
      </p>
    </main>
  );
}
```

- [ ] **Step 2**: Smoke test + commit

```bash
cd web && bun dev
# Visit http://localhost:3000/audit — expected: table with last 50 alerts

git add web/app/audit/page.tsx
git commit -m "$(cat <<'EOF'
feat(web): /audit index page (last 50 non-pegged alerts)

Server component fetches /v1/audit?limit=50&exclude_pegged=true with
60s ISR. Table shows asset, transition, methodology version, receipt
fingerprint, on-chain status. Links to /audit/[id] for each row.

Closes discovery gap — anyone can find recent audit URLs without prior
knowledge.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11.3 — OG image generation per audit

**Files**:
- Create: `web/app/audit/[alert_id]/opengraph-image.tsx`
- (Optional: `web/assets/Inter-Bold.ttf` if missing — download from Google Fonts)

- [ ] **Step 1**: Verify font asset exists

```bash
ls web/assets/Inter-Bold.ttf 2>/dev/null
```

If missing, download from Google Fonts (Inter Bold weight) and place in `web/assets/`.

- [ ] **Step 2**: Write the image component

Write `web/app/audit/[alert_id]/opengraph-image.tsx`:

```tsx
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const API_BASE = process.env.PEGANA_API ?? "https://api.pegana.xyz";

export const alt = "Pegana audit receipt";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type AuditSummary = {
  alert: { asset: string; from_state: string; to_state: string; detected_at: string };
  evidence: { methodology_version: string; receipt_sha256: string };
};

export default async function Image({
  params,
}: { params: Promise<{ alert_id: string }> }) {
  const { alert_id } = await params;
  const data: AuditSummary = await fetch(`${API_BASE}/v1/audit/${alert_id}`)
    .then((r) => r.json())
    .catch(() => ({
      alert: { asset: "?", from_state: "?", to_state: "?", detected_at: "" },
      evidence: { methodology_version: "?", receipt_sha256: "?" },
    }));

  const fontData = await readFile(join(process.cwd(), "assets/Inter-Bold.ttf"));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%)",
          color: "white",
          padding: "60px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          fontFamily: "Inter",
        }}
      >
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

- [ ] **Step 3**: Smoke test + validate social unfurls

```bash
cd web && bun dev
# Visit http://localhost:3000/audit/<real-alert-uuid>/opengraph-image
# Expected: 1200x630 PNG renders

# Manual: paste URL into Twitter Card Validator + Telegram chat in dev mode
# Expected: card preview shows correctly
```

- [ ] **Step 4**: Commit

```bash
git add web/app/audit/[alert_id]/opengraph-image.tsx web/assets/Inter-Bold.ttf
git commit -m "$(cat <<'EOF'
feat(web): dynamic OG image per /audit/[id]

Renders 1200x630 PNG via next/og ImageResponse. Card shows asset
symbol (large), transition badge, methodology version, receipt
fingerprint. Twitter/Telegram unfurls become credibility cards.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11.4 — /methodology page (fresh build)

**Files**: Create `web/app/methodology/page.tsx`

- [ ] **Step 1**: Page implementation

```tsx
// web/app/methodology/page.tsx
import fs from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-static";

async function loadChangelog(): Promise<string> {
  const p = path.join(process.cwd(), "..", "crates", "methodology", "CHANGELOG.md");
  try {
    return await fs.readFile(p, "utf-8");
  } catch {
    return "Changelog unavailable.";
  }
}

export const metadata = {
  title: "Methodology · Pegana",
  description: "How Pegana produces peg-risk alerts: deterministic, versioned, replayable.",
};

export default async function MethodologyPage() {
  const changelog = await loadChangelog();

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold">Methodology</h1>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">What this is</h2>
        <p className="mt-2 text-zinc-700">
          Oracle/intrinsic + executable market quote = spread. Every Pegana alert is
          the output of a deterministic function over four inputs: the asset's
          intrinsic value, market price, threshold configuration from{" "}
          <code>assets.toml</code>, and the EWMA + hysteresis state at the moment of
          decision. The function lives in the open-source{" "}
          <code>pegana-methodology</code> Rust crate, versioned by semver, with
          every release pinned to a git tag.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Verify any alert</h2>
        <pre className="mt-2 overflow-x-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100">
{`# Install (no Rust toolchain needed)
curl --proto '=https' --tlsv1.2 -LsSf \\
  https://releases.pegana.xyz/pegana-replay-installer.sh | sh

# Verify
pegana-replay --alert-id <UUID>

# Or check binary provenance (Sigstore via GitHub Attestations)
gh attestation verify ~/.pegana/bin/pegana-replay \\
  --owner lrafasouza --repo pegana`}
        </pre>
      </section>

      <section className="mt-8" id="lifecycle">
        <h2 className="text-lg font-semibold">Version lifecycle</h2>
        <ul className="mt-2 list-disc space-y-1 pl-6 text-zinc-700">
          <li><strong>active</strong> — current/past version producing trusted alerts</li>
          <li><strong>deprecated</strong> — superseded by a newer version; alerts from it remain valid</li>
          <li><strong>broken</strong> — bug confirmed; past alerts from this version show a warning banner. Engine refuses to run on broken versions.</li>
        </ul>
      </section>

      <section className="mt-8" id="changelog">
        <h2 className="text-lg font-semibold">Changelog</h2>
        <pre className="mt-2 whitespace-pre-wrap rounded bg-zinc-50 p-4 text-sm">
          {changelog}
        </pre>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">What this ISN'T</h2>
        <p className="mt-2 text-zinc-700">
          Pegana's audit log is a verifiable computation log: anyone can prove which
          methodology produced which alert, given which inputs. It is{" "}
          <strong>not</strong> SOC 2 compliance, <strong>not</strong> a regulatory
          audit, and <strong>not</strong> financial advice. Use it to verify our
          claims; do not substitute for your own judgment.
        </p>
      </section>

      <footer className="mt-12 text-xs text-zinc-500">
        <a className="underline" href="https://github.com/lrafasouza/pegana/tree/main/crates/methodology">
          Source on GitHub
        </a>
        {" · "}
        <a className="underline" href="/audit">Browse recent audits</a>
      </footer>
    </main>
  );
}
```

- [ ] **Step 2**: Smoke + commit

```bash
cd web && bun dev  # Visit /methodology

git add web/app/methodology/
git commit -m "$(cat <<'EOF'
feat(web): /methodology page (fresh build)

Renders crates/methodology/CHANGELOG.md at build time. Documents
version lifecycle, install snippet, Sigstore verification, explicit
disclaimer. Includes one-liner methodology copy ("oracle/intrinsic +
executable market quote = spread") per prior strategy session P0.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11.5 — /pricing waitlist page (NEW from strategic P0/P1)

**Files**:
- Create: `web/app/pricing/page.tsx`
- (Optional: `migrations/0032_pricing_waitlist.sql` if persisting waitlist)

- [ ] **Step 1**: Page implementation (waitlist mode, no active tiers)

```tsx
// web/app/pricing/page.tsx
export const metadata = {
  title: "Pricing · Pegana",
  description: "Free during alpha. Paid tiers in development — join the waitlist.",
};

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold">Pricing</h1>
        <p className="mt-2 text-lg text-zinc-700">
          Pegana is free during alpha. Pro / Realtime / Enterprise tiers are
          in development. <strong>We won&apos;t charge until our calibration
          v1 report publishes p95/p99 latency metrics</strong> (target
          2026-06-10) and we have at least one design partner signed.
        </p>
      </header>

      <section className="mt-8 grid gap-4 md:grid-cols-4">
        <div className="rounded border border-zinc-200 p-4">
          <h3 className="font-semibold">Free</h3>
          <p className="mt-1 text-2xl font-bold">$0</p>
          <p className="mt-2 text-sm text-zinc-600">5-min delayed alerts</p>
          <p className="text-sm text-zinc-600">Public RSS feeds</p>
          <p className="text-sm text-zinc-600">MCP free tools</p>
          <p className="text-sm text-zinc-600">Audit URLs</p>
          <p className="mt-3 text-xs text-emerald-600 font-medium">Active now</p>
        </div>
        <div className="rounded border border-zinc-200 p-4 opacity-60">
          <h3 className="font-semibold">Pro</h3>
          <p className="mt-1 text-2xl text-zinc-400">soon</p>
          <p className="mt-2 text-sm text-zinc-600">Current latency</p>
          <p className="text-sm text-zinc-600">WebSocket access</p>
          <p className="text-sm text-zinc-600">Webhook delivery</p>
        </div>
        <div className="rounded border border-zinc-200 p-4 opacity-60">
          <h3 className="font-semibold">Realtime</h3>
          <p className="mt-1 text-2xl text-zinc-400">waitlist</p>
          <p className="mt-2 text-sm text-zinc-600">Sub-second alerts*</p>
          <p className="text-sm text-zinc-600">Priority RPC</p>
          <p className="text-sm text-zinc-600">Dedicated WS</p>
          <p className="mt-3 text-xs text-zinc-500">*only if calibration measures it</p>
        </div>
        <div className="rounded border border-zinc-200 p-4 opacity-60">
          <h3 className="font-semibold">Enterprise</h3>
          <p className="mt-1 text-2xl text-zinc-400">custom</p>
          <p className="mt-2 text-sm text-zinc-600">Custom SLO</p>
          <p className="text-sm text-zinc-600">Custom thresholds</p>
          <p className="text-sm text-zinc-600">White-label embed</p>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-semibold">Join the waitlist</h2>
        <p className="mt-2 text-zinc-700">
          Pro / Realtime / Enterprise will activate after calibration v1 closes
          (2026-06-10) and one design partner signs. Enter your email to be
          notified.
        </p>
        <form className="mt-4 flex gap-2 max-w-md" method="POST" action="/api/waitlist">
          <input
            type="email"
            name="email"
            required
            placeholder="you@example.com"
            className="flex-1 rounded border border-zinc-300 px-4 py-2"
          />
          <button
            type="submit"
            className="rounded bg-emerald-600 px-4 py-2 font-medium text-white"
          >
            Join
          </button>
        </form>
      </section>

      <footer className="mt-12 text-xs text-zinc-500">
        Why no prices yet? See{" "}
        <a className="underline" href="/methodology#lifecycle">methodology lifecycle</a>
        {" "}for why we don&apos;t promise latency before we measure it.
      </footer>
    </main>
  );
}
```

- [ ] **Step 2**: Backend API route (waitlist submissions)

Create `web/app/api/waitlist/route.ts`:

```tsx
import { NextResponse } from "next/server";

const API_BASE = process.env.PEGANA_API ?? "https://api.pegana.xyz";

export async function POST(request: Request) {
  const formData = await request.formData();
  const email = formData.get("email");
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }
  // For v0.1.0: just log to console + return success.
  // Future: persist to Postgres pricing_waitlist table.
  console.log("Waitlist signup:", email);
  return NextResponse.redirect(new URL("/pricing?joined=1", request.url));
}
```

- [ ] **Step 3**: Commit

```bash
git add web/app/pricing/ web/app/api/waitlist/
git commit -m "$(cat <<'EOF'
feat(web): /pricing waitlist page (no active tiers)

Per business rules § 7 — pricing tiers do NOT activate in v0.1.0.
Page shows tier preview cards + waitlist form. Disclosure: "We won't
charge until calibration v1 publishes p95/p99 + design partner signed."

Captures intent without making latency claims that can't be defended.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11.6 — /agents page (NEW from strategic P0/P1)

**Files**: Create `web/app/agents/page.tsx`

- [ ] **Step 1**: Page implementation

```tsx
// web/app/agents/page.tsx
export const metadata = {
  title: "Agents · Pegana",
  description: "Build trust-aware AI agents with Pegana's MCP server.",
};

export default function AgentsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold">Agents</h1>
        <p className="mt-2 text-lg text-zinc-700">
          Pegana exposes peg-risk signals via Model Context Protocol (MCP).
          Agents can subscribe to live state transitions, verify any alert's
          provenance, and use receipts to justify decisions.
        </p>
      </header>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">MCP server</h2>
        <pre className="mt-2 overflow-x-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100">
{`# MCP server URL
https://mcp.pegana.xyz

# Pegana MCP tools:
#   Free: ping, get_assets, get_asset_state, get_methodology, verify_alert
#   Paid (x402): ping_paid, get_asset_history, subscribe_peg_events`}
        </pre>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Example: agent that aborts allocations into drifting assets</h2>
        <pre className="mt-2 overflow-x-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100">
{`// TypeScript agent using Pegana MCP
const events = await mcp.callTool("subscribe_peg_events", {
  symbols: ["USDe", "JupUSD", "USDS"],
  since_ts: lastCursor,
  threshold_bps: 50,
});

for (const e of events.structuredContent.events) {
  if (e.to_state === "DRIFT" || e.to_state === "DEPEG") {
    console.warn(\`Aborting allocation into \${e.asset}: \${e.to_state}\`);
    console.warn(\`Evidence: \${e.evidence_url}\`);
    await haltAllocation(e.asset);

    // Verify the alert before acting (free tool)
    const receipt = await mcp.callTool("verify_alert", { alert_id: e.id });
    logDecision({
      asset: e.asset, action: "halt",
      reason: \`Pegana \${e.to_state}\`,
      receipt_sha256: receipt.structuredContent.evidence.receipt_sha256,
    });
  }
}`}
        </pre>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Why verifiability matters for agents</h2>
        <p className="mt-2 text-zinc-700">
          Autonomous agents that act on financial signals must document why they
          acted. Pegana's <code>evidence_url</code> + <code>receipt_sha256</code>
          give agents a citable, verifiable record of every decision input.
          Audit URLs are reproducible offline via <code>pegana-replay</code>{" "}
          and on-chain via Solana memo commitment.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Pricing</h2>
        <p className="mt-2 text-zinc-700">
          Free MCP tools are free. Paid tools cost $0.0005–$0.005 per call,
          settled via x402 USDC on Solana mainnet. No API keys, no signup —
          payment per request.
        </p>
      </section>

      <footer className="mt-12 text-xs text-zinc-500">
        <a className="underline" href="/methodology">Methodology</a>
        {" · "}
        <a className="underline" href="/audit">Recent audits</a>
        {" · "}
        <a className="underline" href="https://github.com/lrafasouza/pegana/tree/main/mcp-ts">MCP source</a>
      </footer>
    </main>
  );
}
```

- [ ] **Step 2**: Commit

```bash
git add web/app/agents/
git commit -m "$(cat <<'EOF'
feat(web): /agents page (MCP showcase + verify_alert demo)

Pitches Pegana to agent/automation builders. Code snippet showing
allocation halt on DRIFT/DEPEG with audit URL documentation. Critical
for SendAI / solana.new submission (Phase 13.5).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Acceptance verification for Phase 11

- [ ] AC41 — OG image renders 1200×630 PNG; passes Twitter Card Validator
- [ ] AC42 — `/audit` index lists 50 non-PEGGED alerts with methodology filter
- [ ] AC43 — `/methodology` page renders 6 sections including changelog from CHANGELOG.md
- [ ] AC44 — `/pricing` waitlist form submits, no active tier prices
- [ ] AC45 — `/agents` page shows MCP URL + code snippet
- [ ] AC15 — Engine refuses broken methodology (verified in Task 11.1)

---

## Cross-references

- For methodology lifecycle table, see `04-phase-3-audit-persistence.md § Task 3.3`.
- For web pages spec, see `../09-web-pages.md`.
- For Phase 11M maximalist features building on this foundation, see `11-phase-11M-maximalist.md`.
