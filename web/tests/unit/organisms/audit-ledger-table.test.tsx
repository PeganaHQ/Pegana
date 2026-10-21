import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AuditLedgerTable,
  type AuditLedgerRow,
} from "@/components/organisms/audit/audit-ledger-table";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/audit",
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("next/link", () => ({
  default: React.forwardRef<
    HTMLAnchorElement,
    { children?: React.ReactNode; href: string }
  >(function MockLink({ children, href, ...props }, ref) {
    return (
      <a ref={ref} href={href} {...props}>
        {children}
      </a>
    );
  }),
}));

function row(i: number, over: Partial<AuditLedgerRow> = {}): AuditLedgerRow {
  return {
    id: `id-${i}`,
    asset: "jitoSOL",
    symbol: "jitoSOL",
    mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
    klass: "lst",
    fromState: "PEGGED",
    toState: "DRIFT",
    detectedAt: `2026-10-${String((i % 28) + 1).padStart(2, "0")} 12:00:00`,
    methodologyVersion: "0.4.0",
    receiptSha256: `abcdef12${String(i).padStart(56, "0")}`,
    anchored: false,
    ...over,
  };
}

function renderTable(rows: AuditLedgerRow[], empty?: React.ReactNode) {
  return render(
    <TooltipProvider>
      <AuditLedgerTable rows={rows} empty={empty} />
    </TooltipProvider>,
  );
}

describe("AuditLedgerTable", () => {
  it("renders the columns in ledger order", () => {
    renderTable([row(1)]);
    const table = screen.getByRole("table", { name: "Recent audit receipts" });
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((th) => th.textContent);
    expect(headers).toEqual([
      "When · UTC",
      "Asset",
      "Transition",
      "Method",
      "Receipt",
    ]);
    expect(table.querySelectorAll("col")).toHaveLength(5);
  });

  it("stretches the asset link to the receipt across the row", () => {
    renderTable([row(7)]);
    const table = screen.getByRole("table");
    const link = within(table).getByRole("link", {
      name: /View receipt: jitoSOL PEGGED to DRIFT/,
    });
    expect(link.getAttribute("href")).toBe("/audit/id-7");
    expect(link.className).toContain("after:absolute");
    expect(link.className).toContain("after:inset-0");
    expect(link.closest("tr")?.className).toContain("relative");
    // The link lives in the Asset cell (index 1).
    const cells = link.closest("tr")!.querySelectorAll("td");
    expect(cells[1].contains(link)).toBe(true);
  });

  it("keeps the receipt chip clickable above the stretched link", () => {
    renderTable([row(3, { anchored: true })]);
    const table = screen.getByRole("table");
    const chip = within(table).getByRole("button", {
      name: "Copy receipt hash",
    });
    expect(chip.textContent).toContain("abcdef12");
    expect(chip.closest("a")).toBeNull();
    expect(chip.parentElement?.className).toContain("relative");
    expect(chip.parentElement?.className).toContain("z-10");
    expect(within(table).getByText("anchored")).toBeTruthy();
  });

  it("renders the empty slot and no table when there are no rows", () => {
    renderTable([], <p>nothing here</p>);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("nothing here")).toBeTruthy();
  });

  it("falls back to a monogram for an asset outside the canon", () => {
    renderTable([row(1, { asset: "xSOL", symbol: "xSOL", mint: null, klass: null })]);
    const marks = screen.getAllByTestId("audit-asset-monogram");
    expect(marks.length).toBeGreaterThan(0);
    expect(marks[0].textContent).toBe("xS");
  });

  it("pages client-side at 25 rows", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(i));
    renderTable(rows);
    const table = screen.getByRole("table");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(25);
    expect(screen.getByRole("status").textContent).toContain("Page 1 of 2");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(table.querySelectorAll("tbody tr")).toHaveLength(5);
  });

  it("returns to page 1 when the filter (resetKey) changes while mounted", () => {
    // A soft navigation between ?state= filters re-renders the same mounted
    // table with new rows; the page number must not carry over.
    const rowsA = Array.from({ length: 30 }, (_, i) => row(i));
    const rowsB = Array.from({ length: 30 }, (_, i) =>
      row(i + 100, { toState: "DEPEG" }),
    );
    const { rerender } = render(
      <TooltipProvider>
        <AuditLedgerTable rows={rowsA} resetKey="|" />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByRole("status").textContent).toContain("Page 2 of 2");
    rerender(
      <TooltipProvider>
        <AuditLedgerTable rows={rowsB} resetKey="DEPEG|" />
      </TooltipProvider>,
    );
    expect(screen.getByRole("status").textContent).toContain("Page 1 of 2");
    expect(screen.getByRole("table").querySelectorAll("tbody tr")).toHaveLength(
      25,
    );
  });
});
