> ⚠️ **AMENDED** — see [`../AMENDMENTS.md`](../AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original plan preserved below as historical reference.

---

# Phase 10 — Web `/audit/[id]` Page

**Spec reference**: `../09-web-pages.md`
**Acceptance criteria covered**: AC38, AC39, AC40
**Dependencies**: Phase 4 (API endpoints exist)
**Blocks**: Phase 11 (index page + OG image extend this)
**Estimated duration**: 1 day

---

## Overview

Build the public audit receipt page at `pegana.xyz/audit/[alert_id]`. Server component fetches from `/v1/audit/:id`, renders 6 sections. Loading skeleton + custom 404 included.

This phase is just 1 task with 6 sub-steps because all 3 files (`page.tsx`, `loading.tsx`, `not-found.tsx`) share the same layout context.

---

## Task 10.1 — Create /audit/[alert_id] page + loading + not-found

**Files**:
- Create: `web/app/audit/[alert_id]/page.tsx`
- Create: `web/app/audit/[alert_id]/loading.tsx`
- Create: `web/app/audit/[alert_id]/not-found.tsx`

- [ ] **Step 1**: Check Next.js 16 conventions

Per project AGENTS.md rule, before writing Next.js code, read `node_modules/next/dist/docs/` for App Router dynamic segment conventions:

```bash
ls web/node_modules/next/dist/docs/ 2>/dev/null
```

Confirm:
- `params` is a `Promise<{...}>` in Next.js 16 — must `await` before destructure
- `notFound()` import path: `next/navigation`
- File conventions: `page.tsx`, `loading.tsx`, `not-found.tsx` co-located in same dir

- [ ] **Step 2**: Implement `page.tsx`

Write `web/app/audit/[alert_id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";

const API_BASE = process.env.PEGANA_API ?? "https://api.pegana.xyz";

type AuditResponse = {
  alert: {
    id: string;
    asset: string;
    class: string;
    from_state: string;
    to_state: string;
    discount: string;
    intrinsic_usd: string;
    market_usd: string;
    confidence: string;
    detected_at: string;
  };
  evidence: {
    methodology_version: string;
    methodology_git_sha: string | null;
    assets_toml_sha256: string;
    inputs_frozen: Record<string, unknown>;
    computed: Record<string, unknown>;
    has_replay_artifact: boolean;
    receipt_sha256: string;
    onchain_tx_sig: string | null;
    created_at: string;
  };
};

async function fetchAudit(alertId: string): Promise<AuditResponse | null> {
  const resp = await fetch(`${API_BASE}/v1/audit/${alertId}`, {
    next: { revalidate: 60 },
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`API ${resp.status}`);
  return resp.json();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ alert_id: string }>;
}) {
  const { alert_id } = await params;
  return {
    title: `Audit · alert ${alert_id.slice(0, 8)} · Pegana`,
    description: "Public audit receipt for a Pegana peg-risk alert.",
  };
}

export default async function AuditPage({
  params,
}: {
  params: Promise<{ alert_id: string }>;
}) {
  const { alert_id } = await params;
  const data = await fetchAudit(alert_id);
  if (!data) notFound();

  const { alert, evidence } = data;

  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      {/* Section 1: Header */}
      <header className="mb-8">
        <p className="text-xs uppercase tracking-wider text-zinc-500">Audit Receipt</p>
        <h1 className="mt-2 text-3xl font-semibold">
          {alert.asset}{" "}
          <span className="text-zinc-400">
            {alert.from_state} → {alert.to_state}
          </span>
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Detected {new Date(alert.detected_at).toUTCString()}
        </p>
      </header>

      {/* Section 2: Inputs (frozen) */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Inputs (frozen)
        </h2>
        <pre className="mt-2 overflow-x-auto rounded bg-zinc-50 p-4 text-xs">
          {JSON.stringify(evidence.inputs_frozen, null, 2)}
        </pre>
      </section>

      {/* Section 3: Computed */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Computed
        </h2>
        <pre className="mt-2 overflow-x-auto rounded bg-zinc-50 p-4 text-xs">
          {JSON.stringify(evidence.computed, null, 2)}
        </pre>
      </section>

      {/* Section 4: Methodology */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Methodology
        </h2>
        <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500">Version</dt>
            <dd>
              <code>{evidence.methodology_version}</code>{" "}
              <a
                className="text-emerald-600 underline"
                href={`https://github.com/lrafasouza/pegana/tree/methodology-v${evidence.methodology_version}/crates/methodology`}
              >
                source
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Git SHA</dt>
            <dd>
              <code>{evidence.methodology_git_sha ?? "(dev build)"}</code>
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-zinc-500">assets.toml sha256</dt>
            <dd className="font-mono text-xs break-all">
              {evidence.assets_toml_sha256}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-zinc-500">Receipt sha256</dt>
            <dd className="font-mono text-xs break-all">
              {evidence.receipt_sha256}
            </dd>
          </div>
        </dl>
      </section>

      {/* Section 5: Replay */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Replay this alert
        </h2>
        <div className="mt-2 rounded border border-zinc-200 p-4 text-sm">
          {evidence.has_replay_artifact ? (
            <>
              <p className="mb-2">Install the verifier (no Rust toolchain required):</p>
              <pre className="mb-3 overflow-x-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100">
                {`curl --proto '=https' --tlsv1.2 -LsSf \\
  https://releases.pegana.xyz/pegana-replay-installer.sh | sh`}
              </pre>
              <p className="mb-2">Verify:</p>
              <pre className="mb-3 overflow-x-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100">
                {`pegana-replay --alert-id ${alert.id}`}
              </pre>
              <a
                className="inline-block rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white"
                href={`${API_BASE}/v1/audit/${alert.id}/replay-bundle`}
              >
                Download bundle JSON
              </a>
            </>
          ) : (
            <p className="text-zinc-500">
              DRIFT alerts do not include a self-contained replay bundle.
              The inputs above are still sufficient — fetch{" "}
              <code>{`${API_BASE}/v1/audit/${alert.id}`}</code>{" "}
              and run the methodology by hand or via the SDK.
            </p>
          )}
        </div>
      </section>

      {/* Section 6: On-chain commitment (only if populated) */}
      {evidence.onchain_tx_sig && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            On-chain commitment
          </h2>
          <div className="mt-2 rounded border border-zinc-200 p-4 text-sm">
            <p>
              Receipt sha256 anchored on Solana via SPL Memo:{" "}
              <a
                className="font-mono text-xs text-emerald-600 underline break-all"
                href={`https://solscan.io/tx/${evidence.onchain_tx_sig}`}
              >
                {evidence.onchain_tx_sig}
              </a>
            </p>
            <pre className="mt-3 overflow-x-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100">
              {`pegana-replay --alert-id ${alert.id} --verify-onchain`}
            </pre>
          </div>
        </section>
      )}

      {/* Footer with disclaimer */}
      <footer className="mt-12 border-t border-zinc-200 pt-6 text-xs text-zinc-500">
        <p className="mb-3">
          Pegana is a verifiable computation log for peg-state decisions. It is{" "}
          <strong>not</strong> SOC 2 compliance, <strong>not</strong> a regulatory audit,
          and <strong>not</strong> financial advice.
        </p>
        <p>
          <a className="underline" href="/methodology">Methodology and versioning</a>
          {" · "}
          <a className="underline" href="/audit">Browse recent audits</a>
        </p>
      </footer>
    </main>
  );
}
```

- [ ] **Step 3**: Loading state

Write `web/app/audit/[alert_id]/loading.tsx`:

```tsx
export default function Loading() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <div className="h-8 w-64 animate-pulse rounded bg-zinc-200" />
      <div className="mt-4 h-32 w-full animate-pulse rounded bg-zinc-200" />
      <div className="mt-4 h-32 w-full animate-pulse rounded bg-zinc-200" />
      <div className="mt-4 h-32 w-full animate-pulse rounded bg-zinc-200" />
    </main>
  );
}
```

- [ ] **Step 4**: Not-found state

Write `web/app/audit/[alert_id]/not-found.tsx`:

```tsx
export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-24 text-center">
      <p className="text-xs uppercase tracking-wider text-zinc-500">404</p>
      <h1 className="mt-2 text-2xl font-semibold">Audit not found</h1>
      <p className="mt-4 text-zinc-600">
        This alert ID isn&apos;t in our public ledger. It may have predated
        the trust layer, or the URL may be incorrect.
      </p>
      <a className="mt-6 inline-block underline" href="/">
        Back to Pegana
      </a>
    </main>
  );
}
```

- [ ] **Step 5**: Smoke test

```bash
cd web && bun dev
# Visit http://localhost:3000/audit/<a-real-alert-uuid-from-staging>
# Expected: full page renders with all 6 sections (5 always + 6th if on-chain sig populated)
# Visit http://localhost:3000/audit/00000000-0000-0000-0000-000000000000
# Expected: custom 404 page renders
```

- [ ] **Step 6**: Commit

```bash
git add web/app/audit/
git commit -m "$(cat <<'EOF'
feat(web): public /audit/[alert_id] page (6 sections + loading + 404)

Server component fetches /v1/audit/:alert_id with 60s revalidate.
Sections: header, inputs frozen, computed, methodology, replay,
on-chain (conditional). Disclaimer footer. Custom loading skeleton
and not-found page for evidence_missing scenarios.

No auth, indexable, public proof surface.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Acceptance verification for Phase 10

- [ ] AC38 — `/audit/[alert_id]` renders 6 sections for any production alert with `has_replay_artifact=true`
- [ ] AC39 — Loading skeleton renders on slow API responses
- [ ] AC40 — 404 page renders for `evidence_missing` from API

---

## Cross-references

- For web spec, see `../09-web-pages.md`.
- For API endpoint consumed, see `05-phase-4-api.md`.
- For Phase 11 extensions (`/audit` index, OG image, `/methodology`, `/pricing`, `/agents`), see `10-phase-11-lifecycle-index-og.md`.
