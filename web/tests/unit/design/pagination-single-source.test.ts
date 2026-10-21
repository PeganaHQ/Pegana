import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..", "..");
const SKIP_DIRS = new Set(["node_modules", ".next", "worktrees", "test-results"]);

function sourceFiles(): { rel: string; src: string }[] {
  const out: { rel: string; src: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      out.push({
        rel: full.slice(WEB_ROOT.length + 1),
        src: readFileSync(full, "utf8"),
      });
    }
  };
  for (const dir of ["app", "components", "lib"]) walk(join(WEB_ROOT, dir));
  return out;
}

const FILES = sourceFiles();

/**
 * Four surfaces had each grown a private copy of the same paging logic, and the
 * copies had already diverged in five ways (two a11y patterns, two clamping
 * strategies, one missing reset, no URL state anywhere, no scroll restoration).
 * The cost of a fifth copy is not that it is duplicated, it is that it will
 * diverge too, and nothing would notice.
 */
describe("pagination has one implementation", () => {
  it("nobody hand-rolls a Prev/Next control", () => {
    const offenders = FILES.filter(
      (f) =>
        f.rel !== "components/molecules/pagination.tsx" &&
        (f.src.includes("← Prev") || f.src.includes("Next →")),
    ).map((f) => f.rel);

    expect(offenders).toEqual([]);
  });

  it("nobody re-derives a page slice by hand", () => {
    // The shape every copy shared: `slice((page - 1) * size, page * size)`.
    const pattern = /slice\(\s*\(\s*page[A-Za-z]*\s*-\s*1\s*\)\s*\*/;
    const offenders = FILES.filter(
      (f) => f.rel !== "lib/hooks/use-pagination.ts" && pattern.test(f.src),
    ).map((f) => f.rel);

    expect(offenders).toEqual([]);
  });

  it("every paginated surface routes through the shared hook", () => {
    const consumers = FILES.filter((f) =>
      f.src.includes("usePagination({"),
    ).map((f) => f.rel);

    expect(consumers.sort()).toEqual([
      "app/(app)/assets/assets-screener-page.tsx",
      "app/(app)/dashboard/page.tsx",
      "app/(app)/events/page.tsx",
      "components/organisms/audit/audit-ledger-table.tsx",
      "components/organisms/lst/lst-directory-table-v2.tsx",
    ]);
  });

  it("the paging transition kinds have matching CSS", () => {
    const css = readFileSync(join(WEB_ROOT, "app", "globals.css"), "utf8");
    for (const kind of ["page-next", "page-prev"]) {
      expect(css).toContain(`:root[data-vt="${kind}"]::view-transition-old(root)`);
      expect(css).toContain(`:root[data-vt="${kind}"]::view-transition-new(root)`);
    }
  });
});
