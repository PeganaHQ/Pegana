import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { StaticReceiptVerifier } from "@/app/backtest/2025-10-10-usde-depeg/static-receipt-verifier";
import bundle from "../../../../docs/backtests/2025-10-10-usde-depeg/receipts/USDe-001.json";

describe("StaticReceiptVerifier", () => {
  it("verifies a committed backtest receipt entirely in the browser", async () => {
    const user = userEvent.setup();
    render(<StaticReceiptVerifier bundle={bundle} />);

    await user.click(
      screen.getByRole("button", { name: /verify integrity \(hash\)/i }),
    );

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        /integrity verified.*tamper-evident/i,
      );
    });

    // Ensure the success message does NOT imply full verdict re-derivation
    expect(screen.getByRole("status").textContent).not.toMatch(/hash matches/i);
  });
});
