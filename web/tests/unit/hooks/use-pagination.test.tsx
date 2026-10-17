import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockSearch = "";
const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => "/assets",
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

import { usePagination } from "@/lib/hooks/use-pagination";

const items = (n: number) => Array.from({ length: n }, (_, i) => `item-${i}`);

beforeEach(() => {
  mockSearch = "";
  replaceMock.mockClear();
});

describe("usePagination", () => {
  it("slices the current page", () => {
    const { result } = renderHook(() =>
      usePagination({ items: items(25), pageSize: 10 }),
    );

    expect(result.current.totalPages).toBe(3);
    expect(result.current.pageItems).toHaveLength(10);
    expect(result.current.pageItems[0]).toBe("item-0");

    act(() => result.current.nextPage());
    expect(result.current.page).toBe(2);
    expect(result.current.pageItems[0]).toBe("item-10");

    // Last page is the remainder, not a padded full page.
    act(() => result.current.nextPage());
    expect(result.current.pageItems).toHaveLength(5);
  });

  it("never leaves the valid range", () => {
    const { result } = renderHook(() =>
      usePagination({ items: items(12), pageSize: 10 }),
    );

    act(() => result.current.prevPage());
    expect(result.current.page).toBe(1);
    expect(result.current.hasPrev).toBe(false);

    act(() => result.current.goToPage(99));
    expect(result.current.page).toBe(2);
    expect(result.current.hasNext).toBe(false);
  });

  it("treats an empty collection as a single page, not zero", () => {
    // `Math.ceil(0 / 25)` is 0, which is what two of the four replaced copies
    // computed. It never surfaced, because the control only rendered when
    // `totalPages > 1` hid the nonsense. Normalising to 1 here means callers
    // can read totalPages without having to know that.
    const { result } = renderHook(() =>
      usePagination({ items: [], pageSize: 25 }),
    );

    expect(result.current.totalPages).toBe(1);
    expect(result.current.page).toBe(1);
    expect(result.current.pageItems).toEqual([]);
  });

  it("resets to page 1 when the list is reshuffled", () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) =>
        usePagination({ items: items(40), pageSize: 10, resetKey: key }),
      { initialProps: { key: "all" } },
    );

    act(() => result.current.goToPage(3));
    expect(result.current.page).toBe(3);

    // A filter change re-scopes the list, so a page index from the previous
    // scope is meaningless and may point past the new end.
    rerender({ key: "lsts" });
    expect(result.current.page).toBe(1);
  });

  it("does not reset when the reset key is unchanged", () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) =>
        usePagination({ items: items(40), pageSize: 10, resetKey: key }),
      { initialProps: { key: "all" } },
    );

    act(() => result.current.goToPage(2));
    rerender({ key: "all" });
    expect(result.current.page).toBe(2);
  });

  it("clamps rather than flashing an empty page when the list shrinks", () => {
    const { result, rerender } = renderHook(
      ({ n }: { n: number }) => usePagination({ items: items(n), pageSize: 10 }),
      { initialProps: { n: 40 } },
    );

    act(() => result.current.goToPage(4));
    expect(result.current.page).toBe(4);

    // Live data can shrink the list under the reader without any filter
    // change. Clamping on read means there is never a render of an
    // out-of-range page, which an effect-based clamp would produce.
    rerender({ n: 12 });
    expect(result.current.page).toBe(2);
    expect(result.current.pageItems).toHaveLength(2);
  });

  it("does not strip ?page= from the URL before the data arrives", () => {
    // Every consumer renders once with items=[] (useAssets has
    // keepPreviousData but no fallbackData). totalPages was then 1, `current`
    // clamped to 1, and the sync effect "corrected" the URL by DELETING a
    // perfectly good ?page=3 the user had arrived with, restoring it a few
    // hundred ms later once the fetch landed. Copy the address bar in that
    // window and you share a link to page 1 — exactly what the URL sync exists
    // to prevent.
    mockSearch = "page=3";
    const { result, rerender } = renderHook(
      ({ n }: { n: number }) => usePagination({ items: items(n), pageSize: 10 }),
      { initialProps: { n: 0 } },
    );

    expect(replaceMock).not.toHaveBeenCalled();
    // The page the user asked for is remembered across the empty render.
    rerender({ n: 100 });
    expect(result.current.page).toBe(3);
    expect(replaceMock).not.toHaveBeenCalledWith("/assets", { scroll: false });
  });

  it("reads the initial page from the URL", () => {
    mockSearch = "page=3";
    const { result } = renderHook(() =>
      usePagination({ items: items(100), pageSize: 10 }),
    );

    expect(result.current.page).toBe(3);
    expect(result.current.pageItems[0]).toBe("item-20");
  });

  it("ignores a garbage page parameter instead of rendering nothing", () => {
    mockSearch = "page=not-a-number";
    const { result } = renderHook(() =>
      usePagination({ items: items(30), pageSize: 10 }),
    );

    expect(result.current.page).toBe(1);
  });

  it("mirrors the page into the URL without scrolling the document", () => {
    const { result } = renderHook(() =>
      usePagination({ items: items(30), pageSize: 10 }),
    );

    act(() => result.current.goToPage(2));

    expect(replaceMock).toHaveBeenCalledWith("/assets?page=2", {
      scroll: false,
    });
  });

  it("drops the parameter on page 1 rather than leaving ?page=1 behind", () => {
    mockSearch = "page=2";
    const { result } = renderHook(() =>
      usePagination({ items: items(30), pageSize: 10 }),
    );

    act(() => result.current.goToPage(1));
    expect(replaceMock).toHaveBeenCalledWith("/assets", { scroll: false });
  });

  it("leaves the URL alone when syncToUrl is off", () => {
    const { result } = renderHook(() =>
      usePagination({ items: items(30), pageSize: 10, syncToUrl: false }),
    );

    act(() => result.current.goToPage(2));
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("reports the direction so the swap can animate the right way", () => {
    const { result } = renderHook(() =>
      usePagination({ items: items(50), pageSize: 10 }),
    );

    act(() => result.current.goToPage(3));
    expect(result.current.direction).toBe("next");

    act(() => result.current.goToPage(2));
    expect(result.current.direction).toBe("prev");
  });

  it("pluralizes the label off the total, not the page", () => {
    const one = renderHook(() =>
      usePagination({ items: items(1), pageSize: 10, itemNoun: "asset" }),
    );
    expect(one.result.current.label).toBe("Page 1 of 1 · 1 asset");

    const many = renderHook(() =>
      usePagination({ items: items(68), pageSize: 10, itemNoun: "asset" }),
    );
    expect(many.result.current.label).toBe("Page 1 of 7 · 68 assets");
  });
});
