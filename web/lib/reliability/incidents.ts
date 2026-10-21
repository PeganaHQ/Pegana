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
    id: "loop-hf-bands-frozen-2026-10-21",
    date: "2026-10-21",
    title: "Leverage cascade figures used health-factor bands frozen for four days",
    userImpact: "degraded",
    impactNote:
      "From 2026-10-17 09:20 UTC (when recorded history begins) to 2026-10-21 12:35 UTC, the Kamino and Jupiter Lend health-factor bands behind the Loop impact panel, the cascade estimate and /systemic stopped updating, while the exposure totals beside them stayed fresh. The cascade figures were therefore computed from stale positions. These figures are advisory: no peg state, alert or receipt depends on them.",
    durationLabel: "~4 days · cascade and loop figures only",
    summary:
      "After the 2026-10-17 rebuild, the protocol indexer that reads lending positions stopped producing health-factor bands. Once its sources were re-enabled, the Kamino reader loaded every obligation in one unpaginated RPC response and ran its 1 GB container out of memory in a loop. Meanwhile the API kept serving the last bands it had, with no age limit, next to fresh exposure rows, so the panel looked current.",
    detection:
      "Found on 2026-10-20, not by an alert: there was no alert for a failing or stale health-factor source.",
    rootCause:
      "Two gaps together: an unbounded read in the Kamino source, and an API query that took the latest band per asset with no time bound, so a dead source could not show up as stale.",
    resolution:
      "The Kamino reader now streams obligations in pages of 1000 and keeps running on a stray error, and the poll runs hourly. The API drops bands older than three hours and reports the cascade's own age (cascade_updated_at). Alert rules now cover a failing or stale health-factor source. Bands were fresh again from 2026-10-21 12:35 UTC.",
    commits: ["72658234", "59827dc8", "cb2925b5"],
  },
  {
    id: "sanctum-lst-stale-nav-2026-10-20",
    date: "2026-10-20",
    title: "38 liquid-staking tokens showed a false 1.8-3.6% premium for about 3 days",
    userImpact: "degraded",
    impactNote:
      "From 2026-10-17 09:20 UTC to 2026-10-20 10:46 UTC (about 3.06 days), the stored intrinsic value of 38 liquid-staking tokens was 1.8-3.6% too low (average 2.5%), so their discount, 24h range, jitter and worst-spread figures were wrong. No peg state was affected (all stayed Pegged) and no alert or receipt was issued. We have no evidence of any real depeg in that period.",
    durationLabel: "~3.06 days · 38 LSTs, display and history only · resolved 2026-10-21",
    summary:
      "After the 2026-10-17 infrastructure rebuild, the indexer priced Sanctum-path LSTs from the Sanctum API NAV, which lagged the on-chain NAV. The market leg was correct, so each token showed a uniform fake premium. The engine's 10 percent premium-sanity mask never fired because the error was far below it, and a premium alone does not move a token out of Pegged. Affected: all active LSTs except jitoSOL, STKESOL, corvusSOL, rkuSOL and hyloSOL+.",
    detection:
      "The NAV fix shipped on 2026-10-20 (commits 7ee50c2c and ae0f014b). The contamination that remained in stored history, charts and 24h statistics was found afterwards by the 2026-10-21 launch audit, not by our own monitoring.",
    rootCause:
      "The Sanctum API NAV was the sole intrinsic source for these tokens with no cross-check against the on-chain exchange rate, and the only premium sanity bound (10 percent) was far wider than this error. A tighter LST premium bound, or a mandatory on-chain cross-check, would have turned the stale anchor into Unknown instead of a confident Pegged.",
    resolution:
      "Resolved 2026-10-21. The indexer now uses the on-chain NAV with an API-versus-on-chain drift guard, so live values have been correct since 2026-10-20 10:46 UTC. At about 15:25 UTC on 2026-10-21 we removed the affected history instead of keeping or estimating it: 734,446 discount rows and 665,456 intrinsic rows for these 38 tokens, then refreshed the 1-minute aggregate. The post-check found no remaining bad rows and no LST with a premium above 1% in the last 24 hours. Discount and intrinsic_usd history (including MCP get_asset_history) for these tokens now starts at 2026-10-20 10:50 UTC. The 30-day state strip shows no data for the removed days, and a token's /state since can predate its first history point. A backup of the removed rows is kept for audit. Follow-up: a tighter premium-sanity bound for LSTs.",
    commits: ["7ee50c2c", "ae0f014b"],
  },
  {
    id: "production-rebuild-history-gap-2026-10-17",
    date: "2026-10-17",
    title: "Production was rebuilt on a fresh database: history begins 2026-10-17",
    userImpact: "degraded",
    impactNote:
      "Peg history (spreads, charts, the 30-day strip, exports and MCP history) begins 2026-10-17 09:20 UTC. Nothing earlier was recovered. The receipt ledger has receipts from 2026-05-27 to 2026-08-26 and from 2026-10-17 on; nothing exists for 2026-08-26 to 2026-10-17.",
    durationLabel: "history gap · ledger gap 2026-08-26 to 2026-10-17",
    summary:
      "The production server was rebuilt on 2026-10-17 and started on an empty database. On 2026-10-20 the receipt ledger was restored from an offsite backup taken 2026-09-30. That backup held no receipts after 2026-08-26, so the ledger runs to 2026-08-26 and resumes on 2026-10-17. The price and discount history could not be restored from it: the time-series tables were written by an older TimescaleDB version than the rebuilt server runs.",
    detection:
      "Known at the rebuild. The restore was planned and checked against a scratch database before the import.",
    rootCause:
      "Recovery depended on one backup, 17 days old at the rebuild, that could only be partly restored into the current database version. As of 2026-10-21 the offsite backup job is not yet running again; it is waiting on a storage credential.",
    resolution:
      "Receipts from 2026-05-27 to 2026-08-26 were imported into the ledger (they keep their original hashes and replay bundles). Charts now say where their data starts. Backups keep a verified local copy and fail loudly when the offsite upload fails, and restores are gated on the dump's TimescaleDB version. We are not backfilling the missing period with estimates.",
    commits: ["6aed65fe", "6f4b6fdb", "4944c5d7"],
  },
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
