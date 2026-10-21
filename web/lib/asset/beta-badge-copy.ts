/** Visible badge text. Uppercased by CSS → "BETA". */
export const BETA_BADGE_LABEL = "beta";

/**
 * User-facing explanation shown on hover. Deliberately authored HERE rather
 * than echoed from the API's engineer-written `monitoring_reason`, so internal
 * vocabulary (calibration cohorts, percentiles, launch phases, ISO dates)
 * never reaches a user. One honest sentence: the signal is live but the
 * thresholds are still provisional.
 */
export const BETA_BADGE_BODY =
  "Provisional calibration. We track this asset live, but its alert thresholds are still being tuned. Readings may be noisier than fully-calibrated assets.";
