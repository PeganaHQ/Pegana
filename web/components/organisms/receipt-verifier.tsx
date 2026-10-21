"use client";

import { useState } from "react";
import { verifyReceipt, type ReplayBundle } from "@/lib/verify-receipt";
import { parseRetryAfter } from "@/lib/api/client";
import { noteRateLimited, rateLimitWaitMs } from "@/lib/api/freshness";

// Shown when the API asks this browser to slow down. Never the limit, the
// status code or the words "rate limited".
const SLOW_DOWN_MESSAGE =
  "Verification is paused for a moment. Try again in a minute.";

type VerifyState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "pass"; recomputed: string }
  | { status: "fail"; recomputed: string; expected: string }
  | { status: "error"; message: string };

/**
 * In-browser receipt verifier (V5 W2, 2026-07-03 — re-skinned onto the
 * pegana-v2 token set; same fetch/verify logic as before).
 *
 * Fetches the replay bundle from the Pegana API and re-computes the receipt
 * hash using the same algorithm as the Rust engine — no CLI install required.
 * Passes `aria-live="polite"` on the result region so screen readers announce
 * the outcome without disrupting the reading flow.
 */
export function ReceiptVerifier({
  alertId,
  apiBase,
}: {
  alertId: string;
  apiBase: string;
}) {
  const [state, setState] = useState<VerifyState>({ status: "idle" });

  async function handleVerify() {
    // Join the tab-wide 429 gate: while it is open, do not spend more of the
    // shared per-IP window.
    if (rateLimitWaitMs() > 0) {
      setState({ status: "error", message: SLOW_DOWN_MESSAGE });
      return;
    }
    setState({ status: "loading" });
    try {
      const resp = await fetch(`${apiBase}/v1/audit/${alertId}/replay-bundle`);
      if (resp.status === 429) {
        noteRateLimited(parseRetryAfter(resp.headers?.get?.("retry-after")));
        setState({ status: "error", message: SLOW_DOWN_MESSAGE });
        return;
      }
      if (!resp.ok) {
        const text = await resp.text().catch(() => resp.statusText);
        setState({
          status: "error",
          message: `Bundle fetch failed (${resp.status}): ${text}`,
        });
        return;
      }
      const bundle = (await resp.json()) as ReplayBundle;
      const result = await verifyReceipt(bundle);
      if (result.ok) {
        setState({ status: "pass", recomputed: result.recomputed });
      } else {
        setState({
          status: "fail",
          recomputed: result.recomputed,
          expected: result.expected,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ status: "error", message });
    }
  }

  const isLoading = state.status === "loading";

  return (
    <div className="mt-5">
      <button
        type="button"
        onClick={handleVerify}
        disabled={isLoading}
        aria-label="Verify receipt hash in browser"
        className="inline-flex items-center gap-2 rounded-full border border-[var(--v2-line2)] px-5 py-[10px] font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--v2-text)] transition-colors duration-300 hover:border-white/[0.42] hover:bg-white/[0.05] disabled:cursor-wait disabled:opacity-50"
      >
        {isLoading ? (
          <>
            <span
              aria-hidden
              className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
            />
            Verifying...
          </>
        ) : (
          "Verify in browser"
        )}
      </button>

      {state.status !== "idle" && state.status !== "loading" && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="mt-4 rounded-[14px] border p-4"
          style={
            state.status === "pass"
              ? {
                  borderColor: "var(--v2-peg)",
                  background: "rgba(95,211,160,.07)",
                }
              : state.status === "fail"
                ? {
                    borderColor: "var(--v2-crit)",
                    background: "rgba(224,87,78,.07)",
                  }
                : {
                    borderColor: "var(--v2-line)",
                    background: "var(--v2-panel)",
                  }
          }
        >
          {state.status === "pass" && (
            <>
              <p
                className="font-mono text-[11px] uppercase tracking-[0.12em]"
                style={{ color: "var(--v2-peg)" }}
              >
                Hash matches. Self-consistent with the receipt the API returned;
                this check does not confirm the on-chain anchor.
              </p>
              <p className="mt-2 break-all font-mono text-[11px] text-[var(--v2-muted)]">
                {state.recomputed}
              </p>
            </>
          )}
          {state.status === "fail" && (
            <>
              <p
                className="font-mono text-[11px] uppercase tracking-[0.12em]"
                style={{ color: "var(--v2-crit)" }}
              >
                Mismatch. Recomputed hash does not match the receipt returned by
                the API.
              </p>
              <dl className="mt-3 space-y-1">
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--v2-muted)]">
                    Recomputed
                  </dt>
                  <dd className="mt-1 break-all font-mono text-[11px] text-[var(--v2-muted)]">
                    {state.recomputed}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--v2-muted)]">
                    Expected
                  </dt>
                  <dd className="mt-1 break-all font-mono text-[11px] text-[var(--v2-muted)]">
                    {state.expected}
                  </dd>
                </div>
              </dl>
            </>
          )}
          {state.status === "error" && (
            <>
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--v2-muted)]">
                Verification failed
              </p>
              <p className="mt-2 font-mono text-[11px] text-[var(--v2-muted)]">
                {state.message}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
