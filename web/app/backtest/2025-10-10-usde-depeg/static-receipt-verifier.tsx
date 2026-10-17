"use client";

import { useState } from "react";

import {
  verifyReceipt,
  type ReplayBundle,
  type VerifyResult,
} from "@/lib/verify-receipt";

type VerifyState =
  | { status: "idle" }
  | { status: "loading" }
  | ({ status: "done" } & VerifyResult)
  | { status: "error"; message: string };

export function StaticReceiptVerifier({ bundle }: { bundle: ReplayBundle }) {
  const [state, setState] = useState<VerifyState>({ status: "idle" });

  async function handleVerify() {
    setState({ status: "loading" });
    try {
      const result = await verifyReceipt(bundle);
      setState({ status: "done", ...result });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={handleVerify}
        disabled={state.status === "loading"}
        aria-busy={state.status === "loading"}
        className="inline-flex min-h-10 items-center rounded-full border border-outline px-4 text-[12px] font-medium text-text transition-colors duration-200 ease-default hover:border-text hover:bg-text/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-wait disabled:opacity-60"
      >
        {state.status === "loading" ? "Verifying…" : "Verify integrity (hash)"}
      </button>

      {state.status === "done" ? (
        <p
          role="status"
          aria-live="polite"
          className={
            state.ok
              ? "mt-2 font-mono text-[11px] text-st-pegged"
              : "mt-2 font-mono text-[11px] text-st-critical"
          }
        >
          {state.ok
            ? "Integrity verified. The published bundle hashes to its committed value (tamper-evident). This is a hash-only check; the full byte-exact verdict re-derivation runs in the pegana-replay CLI, not the browser."
            : "Mismatch. Committed hash differs."}
        </p>
      ) : null}
      {state.status === "error" ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-2 max-w-prose text-[12px] text-st-critical"
        >
          Verification failed: {state.message}
        </p>
      ) : null}
    </div>
  );
}
