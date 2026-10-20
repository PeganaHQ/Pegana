import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..", "..");
// Comments are stripped so prose explaining the old behaviour cannot trip a
// guard that is about code.
const read = (rel: string) =>
  readFileSync(join(WEB_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

// Paging, sorting and watch-import used router.replace, which is an RSC
// round-trip plus a re-render under a Suspense boundary and read as a page
// reload. They must stay client-side.
describe("dashboard paging and sort never round-trip the server", () => {
  it("usePagination does not touch the app router or the page param", () => {
    const src = read("lib/hooks/use-pagination.ts");
    expect(src).not.toMatch(/useRouter|router\.(replace|push)|useSearchParams/);
    expect(src).not.toMatch(/syncToUrl|paramName/);
  });

  it("the dashboard does not call the app router", () => {
    const src = read("app/(app)/dashboard/page.tsx");
    expect(src).not.toMatch(/useRouter|router\.(replace|push|refresh)/);
    expect(src).toMatch(/replaceQuery\(/);
    expect(src).not.toMatch(/history\.replaceState\([^)]*history\.state/);
  });

  it("the screener sort does not call the app router", () => {
    const src = read("lib/hooks/use-screener-state.ts");
    expect(src).not.toMatch(/useRouter|router\.(replace|push|refresh)/);
    expect(src).toMatch(/replaceQuery\(/);
  });

  it("no consumer re-enables URL sync", () => {
    for (const rel of [
      "app/(app)/dashboard/page.tsx",
      "app/(app)/events/page.tsx",
      "app/(app)/assets/assets-screener-page.tsx",
      "components/organisms/lst/lst-directory-table-v2.tsx",
    ]) {
      expect(read(rel)).not.toMatch(/syncToUrl|paramName/);
    }
  });
});
