import { cache } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/page-metadata";
import { cn } from "@/lib/utils/cn";
import { switzerV2, geistMonoV2 } from "@/app/fonts/v2-fonts";
import { assetClassForIcon, findCanonAsset } from "@/lib/asset/canon";
import { loadAssetsCanonFromRepo } from "@/lib/asset/canon-server";
import { ReceiptVerifier } from "@/components/organisms/receipt-verifier";
import {
  PageHeroV2,
  LiveDot,
} from "@/components/organisms/v2/inner/page-hero-v2";
import { ReceiptObjectV2 } from "@/components/organisms/v2/inner/receipt-object-v2";
import { HashChip } from "@/components/molecules/hash-chip";
import { ReplayCopyPill } from "@/components/molecules/replay-copy-pill";
import { PillGhost, StatePillV2 } from "@/components/organisms/v2/shared";
import { displaySymbol } from "@/lib/asset/display-symbol";
import type { PegState } from "@/lib/api/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "https://api.pegana.xyz";

// Trust-Layer v0.1.0 / Wave 10A, re-platformed onto V5 (W2, 2026-07-03).
//
// Server component. Fetches `${API_BASE}/v1/audit/:id` with a 60s revalidate.
// Receipts are immutable once they exist (content-addressed by receipt_sha256),
// so a longer window is technically safe — 60s gives an escape hatch in case of
// accidental cache poisoning during early operations.
//
// Honors ADR-0006 four-state discrimination: 200 ready, 202 pending,
// 410 failed_permanent, 404 unknown. Pending and failed_permanent render
// inline banners; unknown triggers notFound() → not-found.tsx.
//
// Honors ADR-0013: assets_toml_sha256 short badge (first 7 hex chars) linking
// to /methodology#m-canon (the live canonical asset table — the receipt's
// snapshot hash is over this exact assets.toml).

type AuditAlert = {
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

type AuditEvidence = {
  methodology_version: string;
  methodology_git_sha: string | null;
  assets_toml_sha256: string;
  inputs_frozen: Record<string, unknown>;
  computed: Record<string, unknown>;
  has_replay_artifact: boolean;
  receipt_sha256: string;
  onchain_tx_sig: string | null;
  commit_status: string | null;
  created_at: string;
};

type AuditReadyResponse = {
  alert: AuditAlert;
  evidence: AuditEvidence;
  evidence_status: "ready";
};

type AuditPendingResponse = {
  status: "pending";
  alert_id: string;
  alert_dispatched_at: string;
  retry_after_seconds: number;
  evidence_status: "pending";
};

type AuditFailedResponse = {
  status: "persistence_failed";
  alert_id: string;
  alert_dispatched_at: string;
  last_error: string | null;
  evidence_status: "failed_permanent";
};

type FetchOutcome =
  | { kind: "ready"; data: AuditReadyResponse }
  | { kind: "pending"; data: AuditPendingResponse }
  | { kind: "failed_permanent"; data: AuditFailedResponse }
  | { kind: "not_found" }
  | { kind: "unreachable" };

// `cache()`-wrapped so `generateMetadata` and the page body share ONE fetch per
// request. Next's own fetch memoization would already dedupe these (identical
// URL + structurally-equal options), but that guarantee silently evaporates the
// moment anyone adds an `AbortSignal.timeout()` — a fresh signal makes the
// options non-equal. Making it explicit costs nothing and removes the trap.
const fetchAudit = cache(async (id: string): Promise<FetchOutcome> => {
  let resp: Response;
  try {
    resp = await fetch(`${API_BASE}/v1/audit/${id}`, {
      next: { revalidate: 60 },
    });
  } catch (err) {
    // DNS failure, timeout, connection refused — the API itself is
    // unreachable, not the receipt missing. This must NOT collapse into the
    // same `not_found` outcome as a genuine 404, or an outage renders as
    // "receipt not found" (ADR-0019: missing data != confirming data).
    console.error("audit fetch error", err);
    return { kind: "unreachable" };
  }

  if (resp.status === 404) return { kind: "not_found" };
  if (resp.status === 400) return { kind: "not_found" };
  if (resp.status === 202) {
    const data = (await resp.json()) as AuditPendingResponse;
    return { kind: "pending", data };
  }
  if (resp.status === 410) {
    const data = (await resp.json()) as AuditFailedResponse;
    return { kind: "failed_permanent", data };
  }
  if (!resp.ok) {
    throw new Error(`audit API ${resp.status}`);
  }
  const data = (await resp.json()) as AuditReadyResponse;
  return { kind: "ready", data };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;

  // Describe THIS receipt, not receipts in general. Every receipt previously
  // shared the same boilerplate description even though the asset and the
  // transition were already fetched for the body — so a receipt link posted
  // anywhere looked identical to every other one. This is the artifact the
  // product wants people to share; it should say what it is.
  let detail = "";
  const outcome = await fetchAudit(id);
  if (outcome.kind === "ready") {
    const a = outcome.data.alert;
    detail = ` ${a.asset}: ${a.from_state} → ${a.to_state}, detected ${a.detected_at.slice(0, 10)}.`;
  }

  return pageMetadata({
    title: `Audit · alert ${id.slice(0, 8)}`,
    description:
      `Public audit receipt for a Pegana peg-risk alert.${detail}` +
      " Hash-verifiable off-chain, with optional on-chain anchoring for severe" +
      " (Depeg/Critical/Black Swan) transitions.",
    path: `/audit/${id}`,
  });
}

function isoPretty(iso: string): string {
  try {
    return new Date(iso).toUTCString();
  } catch {
    return iso;
  }
}

// % for end users — "bps" is internal jargon; the receipt's literal JSON
// field name (`discount`) stays as-is (that's the real API contract), only
// this display gets the unit conversion.
/** A numeric field out of the untyped `evidence.computed` bag, as a string the
 *  display helper can take, or null when the receipt does not carry it. */
function computedNum(
  computed: Record<string, unknown>,
  key: string,
): string | null {
  const v = computed[key];
  if (typeof v === "number") return String(v);
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)))
    return v;
  return null;
}

/** The states the on-chain anchor policy covers. A `not_applicable` commit on
 *  one of these is NOT explained by the cost gate, so the receipt must not say
 *  it is. */
const ANCHORED_STATES = new Set(["DEPEG", "CRITICAL", "BLACK_SWAN"]);

function bpsFromDiscount(d: string): string {
  const n = parseFloat(d);
  if (Number.isNaN(n)) return d;
  // Holder convention: the raw `discount` field is premium-NEGATIVE (discount =
  // 1 − market/intrinsic), so displayed as-is the receipt read the sign BACKWARDS
  // vs the dashboard/asset page it proves (QA audit 2026-07-23 — the proof page
  // is exactly where the sign must not contradict). Flip so `+`=premium,
  // `−`=discount, matching holderSignedPct/formatGap everywhere else.
  const pct = -n * 100;
  if (pct === 0) return "0.00%";
  const sign = pct > 0 ? "+" : "−";
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

/** UNKNOWN -> Unknown, BLACK_SWAN -> Black Swan. */
function titleCaseState(state: string): string {
  return state
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

export default async function AuditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [outcome, canon] = await Promise.all([
    fetchAudit(id),
    loadAssetsCanonFromRepo("audit receipt page"),
  ]);

  // Only a genuine 404/400 from the API renders as not-found — a network
  // failure is handled separately below (`unreachable`) so an outage never
  // reads as "this receipt doesn't exist" (ADR-0019).
  if (outcome.kind === "not_found") notFound();

  if (outcome.kind === "unreachable") {
    return <UnreachableView id={id} />;
  }

  if (outcome.kind === "pending") {
    return <PendingView id={id} data={outcome.data} />;
  }
  if (outcome.kind === "failed_permanent") {
    return <FailedView id={id} data={outcome.data} />;
  }

  const { alert, evidence } = outcome.data;
  const meta = findCanonAsset(canon, alert.asset);
  const assetsShort = evidence.assets_toml_sha256.slice(0, 7);
  // The pre-smoothing discount, when the receipt carries it. Shown as its own
  // row so the smoothed number beside it is not mistaken for the same value.
  const rawSpread = computedNum(evidence.computed, "discount_raw");
  const replayCmd = `pegana-replay --alert-id ${alert.id}`;

  return (
    <main className={cn("pegana-v2", switzerV2.variable, geistMonoV2.variable)}>
      <div className="mx-auto max-w-[880px] px-5 pb-4 pt-16 sm:px-8 sm:pt-24">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--v2-muted)]">
          <Link
            href="/audit"
            className="transition-colors hover:text-[var(--v2-text)]"
          >
            Audit ledger
          </Link>
          <span className="mx-2">/</span>
          <span>{id.slice(0, 8)}</span>
        </p>
      </div>
      <PageHeroV2
        eyebrow="Receipt"
        h1={
          <>
            {displaySymbol(alert.asset)} &middot;{" "}
            {titleCaseState(alert.from_state)} &#8594;{" "}
            {titleCaseState(alert.to_state)}
          </>
        }
        maxWidthCh={30}
        lede={
          <>
            {alert.class} &middot; confidence {alert.confidence} &middot; assets
            snapshot {assetsShort}
          </>
        }
        meta={[
          isoPretty(alert.detected_at),
          `methodology v${evidence.methodology_version}`,
          <LiveDot key="verifies">verifies</LiveDot>,
        ]}
        className="pb-6"
      />

      <div className="mx-auto max-w-[880px] px-5 pb-32 sm:px-8">
        <ReceiptObjectV2
          iconLabel={displaySymbol(alert.asset).slice(0, 2)}
          mint={meta?.mint}
          klass={assetClassForIcon(meta?.className)}
          symbol={displaySymbol(alert.asset)}
          subLabel={`${alert.class} · conf ${alert.confidence}`}
          transition={
            <>
              <StatePillV2 state={alert.from_state as PegState} />
              <span className="text-[var(--v2-muted)]">&#8594;</span>
              <StatePillV2 state={alert.to_state as PegState} />
            </>
          }
          rows={[
            { k: "intrinsic", v: alert.intrinsic_usd },
            { k: "market", v: `${alert.market_usd} · best executable route` },
            // NO equation here any more, because the one that used to be
            // printed was false. It rendered
            // `market_usd / intrinsic_usd − 1 = <alert.discount>`, and those
            // two sides are not equal: measured on live receipt
            // 57f142fb (corvusSOL PEGGED→DRIFT), the division gives −1.3134%
            // while the printed answer is −0.87%. The answer is
            // `discount_smooth`, the EWMA output of a LATER pipeline stage,
            // and `discount_raw` is −1.2726% — a third number again, because
            // LSTs derive in SOL space, so the USD pair shown above is a
            // display convenience and never was the computation's input.
            //
            // An earlier pass fixed the SIGN of this equation and left the
            // magnitude wrong, which is worse than no equation at all on the
            // one page whose entire job is showing its work. So the receipt
            // now names each stage's own number instead of asserting a
            // derivation between numbers that do not derive from each other.
            ...(rawSpread
              ? [
                  {
                    k: "spread · raw",
                    v: (
                      <>
                        {bpsFromDiscount(rawSpread)}{" "}
                        <span className="text-[var(--v2-muted)]">
                          · before smoothing
                        </span>
                      </>
                    ),
                  },
                ]
              : []),
            {
              k: rawSpread ? "spread · smoothed" : "spread",
              v: (
                <>
                  <b>{bpsFromDiscount(alert.discount)}</b>{" "}
                  <span className="text-[var(--v2-muted)]">
                    · EWMA, classified against this asset&apos;s thresholds
                  </span>
                </>
              ),
            },
            { k: "canon", v: <>assets.toml {assetsShort}&hellip;</> },
            {
              k: "receipt sha-256",
              v: (
                <HashChip
                  full={evidence.receipt_sha256}
                  display={`${evidence.receipt_sha256.slice(0, 8)}…`}
                />
              ),
            },
            {
              k: "on-chain",
              v: evidence.onchain_tx_sig ? (
                <a
                  href={`https://solscan.io/tx/${evidence.onchain_tx_sig}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {evidence.onchain_tx_sig.slice(0, 12)}&hellip;
                </a>
              ) : evidence.commit_status === "not_applicable" ? (
                // The cost-gate explanation is only TRUE for a state the
                // anchor policy does not cover. Printed unconditionally it
                // contradicted itself: live receipt cb5fb3d9 (xSOL
                // DEPEG→CRITICAL) rendered "cost-gated to
                // Depeg/Critical/Black Swan" directly under a Critical pill —
                // naming Critical as a state that IS anchored, on a receipt
                // that was not.
                //
                // The real reason there is that the asset is monitoring_only
                // and the engine skips anchoring for it at any severity, but
                // /v1/audit/:id carries no monitoring_only field (the index
                // endpoint does). So the page cannot state the reason, and
                // states no reason rather than the wrong one. The offline
                // verifier already treats this case as distinct — it reports
                // ONCHAIN_INCOMPLETE, exit 5, per ADR-0033, instead of a
                // silent pass.
                ANCHORED_STATES.has(alert.to_state)
                  ? "not anchored · replay to check why"
                  : "not anchored · cost-gated to Depeg/Critical/Black Swan"
              ) : evidence.commit_status === "pending" ? (
                "anchoring in progress"
              ) : evidence.commit_status === "retry_exhausted" ? (
                "anchoring failed · retries exhausted"
              ) : evidence.commit_status === "wallet_drained" ? (
                "anchoring paused · operator wallet drained"
              ) : (
                "pending anchor batch"
              ),
            },
          ]}
          replayLine={
            <>
              $ {replayCmd}
              {evidence.has_replay_artifact && (
                <>
                  {" "}
                  <b>&#10003; replay bundle available</b>
                </>
              )}
            </>
          }
        />

        <p className="v2-in-prose">
          This receipt is a <b>frozen computation</b>: the exact inputs, canon
          and methodology version that produced the verdict. Replaying it
          recomputes the same bytes on your machine, or fails loudly.{" "}
          {/* The version and commit are TEXT, and the link goes to the
              published tree that exists.

              This used to link to
              `/tree/methodology-v{version}/crates/methodology`, and that tag
              exists for exactly one version. Every other version in the ledger
              404s — checked all six visible on /audit (0.3.0, 0.4.0, 0.5.0,
              0.6.0, 0.6.1, 0.7.0): only 0.7.0 resolves, and dozens of rows sit
              at 0.5.0 and earlier. Linking the receipt's own
              `methodology_git_sha` instead does not help: the public repo is a
              subtree-mirrored build artifact, so its commits are not the ones
              the receipt records. Both were verified with curl.

              A verification affordance that 404s is worse than none on the one
              page whose job is to be checkable, so the receipt now states the
              version and commit it was built from and points at the source
              that is actually published. Making an old version browsable is a
              release-tagging job in the mirror, not something this page can
              paper over. */}
          Built from methodology v{evidence.methodology_version}
          {evidence.methodology_git_sha && (
            <> at commit {evidence.methodology_git_sha.slice(0, 12)}</>
          )}
          , against the{" "}
          <Link
            href="https://github.com/PeganaHQ/ReplayCLI/tree/main/crates/methodology"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            published methodology source
          </Link>
          .
        </p>

        {evidence.has_replay_artifact ? (
          <ReceiptVerifier alertId={alert.id} apiBase={API_BASE} />
        ) : (
          <p className="mt-4 font-mono text-[12px] text-[var(--v2-muted)]">
            This receipt predates the self-contained replay bundle (before
            2026-05-29 17:55Z). The inputs above are still sufficient to replay
            by hand or via the SDK.
          </p>
        )}

        <div className="mt-9 flex flex-wrap gap-3.5">
          <ReplayCopyPill command={replayCmd} />
          <PillGhost href="/audit">Back to the ledger</PillGhost>
        </div>

        <p className="mt-12 border-t border-[var(--v2-line)] pt-6 font-mono text-[11px] leading-[1.6] text-[var(--v2-muted)]">
          Pegana is a verifiable computation log. Not SOC 2, not a regulatory
          audit, not financial advice.
        </p>
      </div>
    </main>
  );
}

// Honest "the feed is unreachable" state for a network-level failure
// (DNS/timeout/refused) — distinct from `notFound()`, which asserts the
// receipt genuinely doesn't exist. Retrying is just reloading this same URL;
// there's no client-side mutate/refetch available on a server component.
function UnreachableView({ id }: { id: string }) {
  return (
    <main className={cn("pegana-v2", switzerV2.variable, geistMonoV2.variable)}>
      <PageHeroV2
        eyebrow="Receipt"
        h1="Feed unreachable."
        lede={
          <>
            The Pegana API isn&apos;t responding right now, so this receipt
            couldn&apos;t be loaded. This doesn&apos;t mean it&apos;s missing.
            Try again once the feed is healthy.
          </>
        }
        meta={[`id ${id.slice(0, 8)}`]}
      />
      <div className="mx-auto max-w-[880px] px-5 pb-32 sm:px-8">
        <div className="flex flex-wrap gap-3.5">
          <PillGhost href={`/audit/${id}`}>Retry now</PillGhost>
          <PillGhost href="/status">Check status</PillGhost>
          <PillGhost href="/audit">Back to the ledger</PillGhost>
        </div>
      </div>
    </main>
  );
}

function PendingView({ id, data }: { id: string; data: AuditPendingResponse }) {
  return (
    <main className={cn("pegana-v2", switzerV2.variable, geistMonoV2.variable)}>
      <PageHeroV2
        eyebrow="Receipt"
        h1="Receipt pending."
        lede={
          <>
            The alert was dispatched at {isoPretty(data.alert_dispatched_at)}{" "}
            but the receipt write to the audit ledger is still being retried.
            The retry protocol guarantees the receipt will land or this page
            will flip to a permanent failure state.
          </>
        }
        meta={[
          `retry interval ${data.retry_after_seconds}s`,
          `id ${id.slice(0, 8)}`,
        ]}
      />
      <div className="mx-auto max-w-[880px] px-5 pb-32 sm:px-8">
        <PillGhost href="/audit">Back to recent audits</PillGhost>
      </div>
    </main>
  );
}

function FailedView({ id, data }: { id: string; data: AuditFailedResponse }) {
  return (
    <main className={cn("pegana-v2", switzerV2.variable, geistMonoV2.variable)}>
      <PageHeroV2
        eyebrow="Receipt"
        h1="Receipt unavailable."
        lede={
          <>
            The alert was dispatched at {isoPretty(data.alert_dispatched_at)}{" "}
            but the receipt could not be written to the audit ledger after
            repeated retries. By design, this page exists so we never silently
            drop a dispatched alert.
            {data.last_error && (
              <>
                {" "}
                Last error: <code>{data.last_error}</code>
              </>
            )}
          </>
        }
        meta={[`id ${id.slice(0, 8)}`]}
      />
      <div className="mx-auto max-w-[880px] px-5 pb-32 sm:px-8">
        <PillGhost href="/audit">Back to recent audits</PillGhost>
      </div>
    </main>
  );
}
