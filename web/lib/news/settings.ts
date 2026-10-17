/**
 * Market-feed preferences: how many items, and which kinds.
 *
 * Modelled on tokens.xyz's `floating-market-feed-utils.ts`
 * (solana-foundation/tokens, MIT), including the invariant that makes the whole
 * thing safe: **both kinds can never be off at once**. Turning off the last one
 * turns the other back on, so there is no reachable state where the panel is
 * empty because of settings rather than because of the news.
 *
 * Pure and I/O-free. Reading and writing localStorage is the component's job;
 * everything here is a total function over plain values, so the invariant is
 * unit-testable without a DOM.
 *
 * One deliberate difference from the reference: our default is news-on. Theirs
 * defaults to posts-only because @tokens is their own channel; here the
 * headlines are the substance and there is no first-party channel to favour.
 */

export type FeedSize = 15 | 25 | 50;
export type FeedSource = "all" | "news" | "posts";

export interface FeedSettings {
  size: FeedSize;
  showNews: boolean;
  showPosts: boolean;
}

export const FEED_SIZE_OPTIONS = [15, 25, 50] as const satisfies readonly FeedSize[];

export const DEFAULT_FEED_SETTINGS: FeedSettings = {
  size: 25,
  showNews: true,
  showPosts: true,
};

export const FEED_SETTINGS_STORAGE_KEY = "pegana:feed_settings_v1";

export function isFeedSize(v: unknown): v is FeedSize {
  return FEED_SIZE_OPTIONS.includes(v as FeedSize);
}

/** Cycle 15 → 25 → 50 → 15. Used by the size control in the menu. */
export function nextFeedSize(current: FeedSize): FeedSize {
  const i = FEED_SIZE_OPTIONS.indexOf(current);
  return FEED_SIZE_OPTIONS[(i < 0 ? 0 : i + 1) % FEED_SIZE_OPTIONS.length]!;
}

/**
 * Coerce anything (a stale localStorage blob, a hand-edited value, undefined)
 * into valid settings. Never throws, never returns a both-off state.
 */
export function sanitizeFeedSettings(value: unknown): FeedSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_FEED_SETTINGS;
  }
  const v = value as Record<string, unknown>;
  const size = isFeedSize(v.size) ? v.size : DEFAULT_FEED_SETTINGS.size;
  const showNews =
    typeof v.showNews === "boolean" ? v.showNews : DEFAULT_FEED_SETTINGS.showNews;
  const showPosts =
    typeof v.showPosts === "boolean" ? v.showPosts : DEFAULT_FEED_SETTINGS.showPosts;

  // A persisted both-off state is unusable; fall back rather than honour it.
  if (!showNews && !showPosts) return DEFAULT_FEED_SETTINGS;

  return { size, showNews, showPosts };
}

/**
 * Apply a partial change, preserving the both-on-required invariant.
 *
 * Turning off the kind that is currently the only one on flips the OTHER on,
 * rather than rejecting the click. That is the behaviour that makes a two-switch
 * filter feel correct instead of stuck: the user always gets a visible response.
 */
export function applyFeedSettings(
  previous: FeedSettings,
  patch: Partial<FeedSettings>,
): FeedSettings {
  const next = { ...previous, ...patch };

  if (!next.showNews && !next.showPosts) {
    if (patch.showNews === false) return sanitizeFeedSettings({ ...next, showPosts: true });
    if (patch.showPosts === false) return sanitizeFeedSettings({ ...next, showNews: true });
  }

  return sanitizeFeedSettings(next);
}

/** The `source` query param these settings imply. */
export function feedSource(s: FeedSettings): FeedSource {
  if (s.showNews && s.showPosts) return "all";
  if (s.showNews) return "news";
  if (s.showPosts) return "posts";
  return "all";
}

/** What to call the absent thing in the empty state, given the active filter. */
export function emptyNoun(s: FeedSettings): string {
  const src = feedSource(s);
  if (src === "news") return "news";
  if (src === "posts") return "posts";
  return "updates";
}
