// "Watch the watchers" — Pegana's public reliability log. A peg-risk oracle
// asks users to trust its alerts, so it publishes the issues its OWN monitoring
// caught, in full, even when no user was affected. Each entry follows a
// blameless post-mortem shape (summary · impact · detection · root cause ·
// resolution) modelled on Google SRE / Atlassian Statuspage conventions.

/** Public launch date (Trust Layer went live, FEATURE_PUBLIC_ALERTS on). */
export const LAUNCH_DATE = "2026-06-11";

export type UserImpact = "none" | "degraded" | "outage";

export interface ReliabilityEntry {
  id: string;
  /** YYYY-MM-DD (UTC). */
  date: string;
  title: string;
  /** Whether any public user was actually affected. The whole point of this
   *  log is that these were caught BEFORE user impact — most are "none". */
  userImpact: UserImpact;
  /** One-line, plain-language impact statement. */
  impactNote: string;
  /** Human duration / scope, e.g. "~7.5 min, internal only". */
  durationLabel: string;
  summary: string;
  detection: string;
  /** Systemic root cause (blameless — process/tooling, not people). */
  rootCause: string;
  resolution: string;
  /** Short commit SHAs that shipped the fix. */
  commits: string[];
}

/** Newest first; does not mutate the input. */
export function sortByDateDesc<T extends { date: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );
}

/** Whole UTC days between an ISO date (YYYY-MM-DD) and `nowMs`. Clamped at 0. */
export function daysSince(fromISO: string, nowMs: number): number {
  const from = Date.parse(`${fromISO}T00:00:00Z`);
  if (Number.isNaN(from)) return 0;
  return Math.max(0, Math.floor((nowMs - from) / 86_400_000));
}

/** Entries that actually reached users (the honest headline number). */
export function userFacingCount(entries: ReliabilityEntry[]): number {
  return entries.filter((e) => e.userImpact !== "none").length;
}

export const RELIABILITY_LOG: ReliabilityEntry[] = [
  {
    id: "freeze-detector-false-jupsol-2026-06-14",
    date: "2026-06-14",
    title: "A new freeze detector briefly mislabelled JupSOL as Unknown",
    userImpact: "degraded",
    impactNote:
      "~9 minutes. JupSOL (a public asset) emitted a false Pegged→Unknown→Pegged alert; the signal then self-corrected. Five other affected assets were monitoring-only, so the egress gate kept them off the public feed. No asset was actually off its peg.",
    durationLabel: "~9 min · 1 public asset",
    summary:
      "We shipped an engine 'freeze detector' meant to publish UNKNOWN when a price basis stops moving (a real failure mode we'd just found on another asset). Its threshold, 20 consecutive identical samples, about 3 minutes, was too low for thinly-traded liquid-staking tokens, whose price ratio is naturally constant for minutes between trades. Six such assets, including the public JupSOL, were briefly and wrongly marked Unknown.",
    detection:
      "Caught minutes later by our own post-deploy full-state verification. Assets had gone Unknown with no corroborating market move.",
    rootCause:
      "The pre-deploy validation measured the total number of distinct values over 6 hours, not the maximum consecutive-identical run the detector actually keys on. So it missed that a healthy but illiquid asset routinely sits identical for a few minutes. A threshold tuned to minutes cannot tell 'frozen for hours' (the real failure) from 'no trade for a few minutes' (normal).",
    resolution:
      "Reverted the freeze detector and redeployed the engine; every state recovered within ~9 minutes. The separate containment of the genuinely-frozen asset (hyloSOL+) was unaffected. The detector will be redesigned around a multi-hour window, or to detect the upstream source freeze directly, and re-validated on the exact metric it uses, before any redeploy.",
    commits: ["ee7301a", "7aadf34"],
  },
  {
    id: "jupusd-false-critical-2026-06-12",
    date: "2026-06-12",
    title: "JupUSD briefly read CRITICAL on a single bad market quote",
    userImpact: "none",
    impactNote:
      "0 users affected. JupUSD was a brand-new monitoring-only asset with no subscribers, and this was not a real depeg. (We have since added an egress gate so a monitoring-only asset can never reach the public feed at all. See the next entry.)",
    durationLabel: "~7.5 min · internal only",
    summary:
      "A single Jupiter market quote returned a zero output amount, so the market price computed as $0 and the discount pinned to exactly 1.0 (−100%). That one bad sample poisoned the smoothing filter (EWMA, α=0.3) and JupUSD briefly classified CRITICAL even though the market had not moved.",
    detection:
      "Flagged by our own post-launch T+24h health scorecard. A CRITICAL on an otherwise calm asset with no corroborating market move stood out immediately.",
    rootCause:
      "Two systemic gaps: the plausibility check accepted an impossible reading (a market price of exactly $0) instead of rejecting it, and the source adapter had no floor to drop a zero / near-zero quote before it entered the pipeline.",
    resolution:
      "The indexer now skips zero and near-zero Jupiter output amounts and applies a NAV floor at the source, and the plausibility guard was tightened to strictly < 1.0 so a fully-zeroed price can never reach the smoothing filter again.",
    commits: ["05245c1", "6b7bb53"],
  },
  {
    id: "monitoring-only-egress-gap-2026-06-12",
    date: "2026-06-12",
    title: "Uncalibrated assets could have reached the public alert feed",
    userImpact: "none",
    impactNote:
      "0 users affected. Caught and gated before any uncalibrated asset emitted a public alert.",
    durationLabel: "found pre-impact",
    summary:
      "A calibration downgrade marked 11 uncalibrated assets as monitoring-only, but the flag was display-only: the engine and dispatcher had no awareness of it, so those assets could in principle have emitted alerts on the public feed.",
    detection:
      "Found during a pre-promotion review of the full alert egress path, before any uncalibrated asset transitioned.",
    rootCause:
      "The monitoring-only status was stored as metadata with no corresponding enforcement at the public egress surfaces. A status flag without a gate.",
    resolution:
      "An egress gate now filters monitoring-only assets at every public surface: the alerts list, the audit ledger (index and CSV), the stats counters, the dispatcher fan-out, and the engine's on-chain commit. Internal rows are still recorded for the calibration retro.",
    commits: ["7e4bf8f"],
  },
];

/** RELIABILITY_LOG sorted newest-first, once at module load — the log is static,
 *  so the page renders this directly instead of re-sorting on every tick. */
export const RELIABILITY_LOG_DESC: ReliabilityEntry[] =
  sortByDateDesc(RELIABILITY_LOG);
