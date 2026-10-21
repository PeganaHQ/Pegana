import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import {
  ListRowsV2,
  ListRowHead,
  ListRow,
} from "@/components/organisms/v2/inner/list-rows-v2";

describe("ListRowsV2", () => {
  it("puts the head in <thead>, outside <tbody>", () => {
    const { container } = render(
      <ListRowsV2 label="t">
        <ListRowHead columns="1fr 1fr">
          <span>A</span>
          <span>B</span>
        </ListRowHead>
        <ListRow columns="1fr 1fr">
          <span>1</span>
          <span>2</span>
        </ListRow>
      </ListRowsV2>,
    );
    const table = container.querySelector("table")!;
    const tags = [...table.children].map((c) => c.tagName);
    expect(tags).toEqual(["COLGROUP", "THEAD", "TBODY"]);
    expect(table.querySelector("tbody thead")).toBeNull();
  });

  it('is not a "use client" module (server pages pass rows into it; #418 on /audit)', () => {
    const src = readFileSync(
      join(process.cwd(), "components/organisms/v2/inner/list-rows-v2.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/^\s*["']use client["']/m);
  });
});
