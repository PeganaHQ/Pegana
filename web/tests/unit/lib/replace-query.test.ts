import { afterEach, describe, expect, it, vi } from "vitest";
import { replaceQuery } from "@/lib/url/replace-query";

// Mirrors next/dist/client/components/app-router.js (16.4.2): the patched
// replaceState syncs useSearchParams ONLY when the state is not an app-router
// entry (`__NA` / `_N`). Passing window.history.state through skips the sync.
function installNextPatch(onSync: (url: string) => void) {
  const original = window.history.replaceState.bind(window.history);
  window.history.replaceState = function (data, unused, url) {
    const d = data as { __NA?: boolean; _N?: boolean } | null;
    if (d?.__NA || d?._N) return original(data, unused, url);
    if (url) onSync(String(url));
    return original(data, unused, url);
  };
  return () => {
    window.history.replaceState = original;
  };
}

describe("replaceQuery", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
    window.history.replaceState(null, "", "/");
  });

  it("passes null state to history.replaceState", () => {
    const spy = vi.spyOn(window.history, "replaceState");
    window.history.replaceState({ __NA: true }, "", "/dashboard#x");
    spy.mockClear();
    replaceQuery(new URLSearchParams("sort=spread&dir=asc"));
    expect(spy).toHaveBeenCalledWith(
      null,
      "",
      "/dashboard?sort=spread&dir=asc#x",
    );
    spy.mockRestore();
  });

  it("still triggers Next's useSearchParams sync from an app-router history entry", () => {
    const synced: string[] = [];
    restore = installNextPatch((u) => synced.push(u));
    // The live entry carries __NA, as every App Router page does.
    window.history.replaceState({ __NA: true }, "", "/dashboard");
    replaceQuery(new URLSearchParams("sort=spread"));
    expect(synced).toEqual(["/dashboard?sort=spread"]);
  });

  it("drops the query entirely when empty", () => {
    window.history.replaceState(null, "", "/assets?page=2");
    replaceQuery(new URLSearchParams());
    expect(window.location.pathname + window.location.search).toBe("/assets");
  });
});
