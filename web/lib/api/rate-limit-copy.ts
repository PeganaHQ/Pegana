// Shared wording for when the public API asks this browser to slow down (a
// 429). The API is healthy and the page resumes on its own, so visitors see a
// calm "paused" line: never the words "rate limited", never the per-IP limit,
// never a status code. Everything that renders on a 429 uses these strings.
export const RATE_LIMITED_LABEL = "Live updates paused";
export const RATE_LIMITED_BODY =
  "Live updates are paused for a moment and resume on their own.";
/** Short inline form for strips that already show data. */
export const LIVE_PAUSED_INLINE = "Live updates paused, resuming shortly.";
