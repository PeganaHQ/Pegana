import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEED_SETTINGS,
  applyFeedSettings,
  emptyNoun,
  feedSource,
  nextFeedSize,
  sanitizeFeedSettings,
  type FeedSettings,
} from "@/lib/news/settings";

/**
 * The invariant this file exists for: BOTH kinds can never be off at once.
 *
 * A two-switch filter where turning off the second switch does nothing feels
 * broken; one where it empties the panel IS broken. The rule is that the last
 * switch off flips the other on, so every click produces a visible, valid state.
 */

const on: FeedSettings = { size: 25, showNews: true, showPosts: true };

describe("applyFeedSettings — never both off", () => {
  it("turning off the last remaining kind flips the other on", () => {
    const newsOnly = applyFeedSettings(on, { showPosts: false });
    expect(newsOnly).toMatchObject({ showNews: true, showPosts: false });

    // Now switch off the only one left: posts must come back on.
    const flipped = applyFeedSettings(newsOnly, { showNews: false });
    expect(flipped.showNews || flipped.showPosts).toBe(true);
    expect(flipped).toMatchObject({ showNews: false, showPosts: true });
  });

  it("is symmetric — same behaviour starting from posts-only", () => {
    const postsOnly = applyFeedSettings(on, { showNews: false });
    const flipped = applyFeedSettings(postsOnly, { showPosts: false });
    expect(flipped).toMatchObject({ showNews: true, showPosts: false });
  });

  it("no sequence of toggles can reach a both-off state", () => {
    let s = on;
    for (const patch of [
      { showNews: false },
      { showPosts: false },
      { showNews: false },
      { showPosts: false },
      { showNews: false },
    ]) {
      s = applyFeedSettings(s, patch);
      expect(
        s.showNews || s.showPosts,
        `both kinds ended up off after ${JSON.stringify(patch)}`,
      ).toBe(true);
    }
  });

  it("carries unrelated fields through untouched", () => {
    const s = applyFeedSettings({ ...on, size: 50 }, { showPosts: false });
    expect(s.size).toBe(50);
  });
});

describe("sanitizeFeedSettings — total over junk", () => {
  it("falls back for null, arrays, primitives and undefined", () => {
    for (const junk of [null, undefined, [], 7, "x", true]) {
      expect(sanitizeFeedSettings(junk)).toEqual(DEFAULT_FEED_SETTINGS);
    }
  });

  it("repairs a persisted both-off blob rather than honouring it", () => {
    // Reachable if someone hand-edits localStorage, or if a past version
    // allowed it. Honouring it would render an empty panel with no explanation.
    expect(
      sanitizeFeedSettings({ size: 15, showNews: false, showPosts: false }),
    ).toEqual(DEFAULT_FEED_SETTINGS);
  });

  it("keeps valid fields and defaults only the invalid ones", () => {
    expect(sanitizeFeedSettings({ size: 999, showNews: false, showPosts: true }))
      .toEqual({ size: DEFAULT_FEED_SETTINGS.size, showNews: false, showPosts: true });
  });
});

describe("nextFeedSize", () => {
  it("cycles 15 → 25 → 50 → 15", () => {
    expect(nextFeedSize(15)).toBe(25);
    expect(nextFeedSize(25)).toBe(50);
    expect(nextFeedSize(50)).toBe(15);
  });
});

describe("feedSource / emptyNoun", () => {
  it("maps the two switches onto the API's source param", () => {
    expect(feedSource({ ...on })).toBe("all");
    expect(feedSource({ ...on, showPosts: false })).toBe("news");
    expect(feedSource({ ...on, showNews: false })).toBe("posts");
  });

  it("names the absent thing after the active filter", () => {
    expect(emptyNoun({ ...on })).toBe("updates");
    expect(emptyNoun({ ...on, showPosts: false })).toBe("news");
    expect(emptyNoun({ ...on, showNews: false })).toBe("posts");
  });
});
