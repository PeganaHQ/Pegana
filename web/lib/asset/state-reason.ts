// Advisory `state_reason` (API) → terse UNKNOWN-state copy. Null when the
// reason is absent/unrecognised (caller renders nothing).
export function stateReasonLabel(reason?: string): string | null {
  switch (reason) {
    case "premium_sanity":
      return "price above NAV looks unreliable; thin market";
    case "discount_sanity":
      return "price below NAV looks unreliable; check the feed";
    case "stale_source":
      return "source stale";
    case "pyth_confidence_gate":
      return "oracle confidence too wide; reading not trusted";
    case "intrinsic_liveness":
      return "backing looks frozen; not confirming a peg";
    default:
      return null;
  }
}
