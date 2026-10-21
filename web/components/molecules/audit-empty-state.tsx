import Link from "@/components/atoms/intent-link";

// Trust-Layer v0.1.0. AuditEmptyState.
//
// Pure, side-effect-free render of the four possible "nothing-to-show"
// states on /audit. Extracted from the page route so it's testable in
// isolation — the page itself depends on a server-side fetch + searchParams
// which are hard to drive in unit tests.
//
// Decision matrix (kind, inCalibrationWindow):
//   ("unreachable", true ) → muted "API offline" (banner already carries
//                            the calibration narrative, so we don't double up
//                            on alarm)
//   ("unreachable", false) → critical "audit API unreachable" — post-gate
//                            outage is genuinely alarming
//   ("calibration", _    ) → drift-tinted "calibration window" narrative
//   ("post-gate-empty", _) → neutral hairline empty
//
// The page picks the kind; this component renders it. Only "unreachable"
// and "post-gate-empty" are reachable from /audit today — the verdict gate
// (2026-06-11) has passed, so page.tsx's pickEmptyKind() never emits
// "calibration" anymore (see components/organisms/audit-calibration-view.tsx
// removal, Wave 2C). The branch stays here (still exercised by
// tests/unit/molecules/audit-empty-state.test.tsx) in case a future
// re-calibration window needs it.
//
// V5 port (Wave 2C, 2026-07-16): restyled from pre-V5 tokens
// (border-hairline/bg-surface-1/rounded-sm/text-st-*) onto `.pegana-v2`'s
// `--v2-*` tokens — this always renders nested inside audit/page.tsx's own
// `.pegana-v2` scope, so no extra scope wrapper is needed here. Card
// geometry matches `.v2-in-inc` (rounded-[16px] panel, IncidentCardV2).

export type AuditEmptyKind = "unreachable" | "calibration" | "post-gate-empty";

interface Props {
  kind: AuditEmptyKind;
  inCalibrationWindow: boolean;
  apiBase: string;
  stateFilter: string | null;
}

export function AuditEmptyState({
  kind,
  inCalibrationWindow,
  apiBase,
  stateFilter,
}: Props) {
  if (kind === "unreachable") {
    if (inCalibrationWindow) {
      // The CalibrationBanner above already explains why the feed is quiet.
      // Don't pile a critical-red box on top of it — that reads as panic.
      return (
        <div
          role="status"
          className="rounded-[16px] border border-[var(--v2-line)] bg-[var(--v2-panel)] p-6 text-[14px] sm:p-7"
          data-testid="audit-empty-unreachable-calm"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--v2-dim)]">
            audit api offline
          </p>
          <p className="mt-2 text-[var(--v2-body)]">
            We couldn&apos;t reach{" "}
            <code className="font-mono text-[13px] text-[var(--v2-text)]">
              {apiBase}/v1/audit
            </code>{" "}
            right now. Receipts persist on the backend. See the calibration
            banner above for the public-feed timeline.
          </p>
        </div>
      );
    }
    return (
      <div
        role="alert"
        className="rounded-[16px] border border-[rgba(224,87,78,.4)] bg-[rgba(224,87,78,.06)] p-6 text-[14px] sm:p-7"
        data-testid="audit-empty-unreachable-critical"
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--v2-crit)]">
          audit api unreachable
        </p>
        <p className="mt-2 text-[var(--v2-body)]">
          We couldn&apos;t reach{" "}
          <code className="font-mono text-[13px] text-[var(--v2-text)]">
            {apiBase}/v1/audit
          </code>{" "}
          to render this page. Try again in a moment. Receipts persist on the
          backend either way.
        </p>
      </div>
    );
  }

  if (kind === "calibration") {
    return (
      <div
        role="status"
        className="rounded-[16px] border border-[rgba(226,166,81,.4)] bg-[rgba(226,166,81,.06)] p-6 text-[14px] sm:p-7"
        data-testid="audit-empty-calibration"
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--v2-drift)]">
          calibration window · gate Jun 11, 2026
        </p>
        <p className="mt-2 text-[var(--v2-body)]">
          The engine is running in dogfood mode through{" "}
          <span className="text-[var(--v2-text)]">June 10, 2026</span>. Alerts
          and receipts are being generated and persisted, but the public audit
          feed stays quiet until the verdict rule confirms calibration v1.
        </p>
        <p className="mt-3 text-[var(--v2-muted)]">
          Want to see the methodology that&apos;ll produce these alerts?{" "}
          <Link
            href="/methodology"
            className="text-[var(--v2-text)] underline-offset-2 hover:underline"
          >
            Read /methodology
          </Link>
          .
        </p>
      </div>
    );
  }

  // post-gate-empty
  return (
    <div
      role="status"
      className="rounded-[16px] border border-[var(--v2-line)] bg-[var(--v2-panel)] p-6 text-[14px] text-[var(--v2-muted)] sm:p-7"
      data-testid="audit-empty-post-gate"
    >
      No recent non-pegged alerts in the current window
      {stateFilter ? ` for state ${stateFilter}` : ""}.
    </div>
  );
}
