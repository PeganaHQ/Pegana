/**
 * ADR-0033: the in-browser verifier is permanently hash-only (no RPC call,
 * unlike the CLI's default-on on-chain check). Its PASS/FAIL copy must say
 * so precisely — "hash matches" / "the receipt returned by the API" — and
 * must NOT use the ambiguous pre-ADR-0033 wording ("Verified." / "the
 * committed receipt") that reads as if the on-chain anchor was checked too.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReceiptVerifier } from "@/components/organisms/receipt-verifier";
import type { ReplayBundle } from "@/lib/verify-receipt";

function loadFixture(name: string): ReplayBundle {
  const p = resolve(__dirname, "../../fixtures", name);
  return JSON.parse(readFileSync(p, "utf-8")) as ReplayBundle;
}

afterEach(() => {
  vi.restoreAllMocks();
});

function stubFetchOnce(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })),
  );
}

describe("ReceiptVerifier", () => {
  it("PASS copy says 'hash matches', not the ambiguous pre-ADR-0033 'Verified.'/'committed receipt'", async () => {
    const bundle = loadFixture("replay-bundle-sample.json");
    stubFetchOnce(bundle);
    const user = userEvent.setup();
    render(<ReceiptVerifier alertId="test-alert" apiBase="https://api.test" />);

    await user.click(
      screen.getByRole("button", { name: /verify receipt hash in browser/i }),
    );

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/hash matches/i);
    });
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).not.toMatch(/^verified\.?/i);
    expect(text.toLowerCase()).not.toContain("committed receipt");
  });

  it("FAIL copy says 'the receipt returned by the API', not 'the committed receipt' — recomputes rather than trusting a tampered field", async () => {
    const bundle = loadFixture("replay-bundle-sample.json");
    // Tamper a frozen input and leave expected_receipt_sha256 untouched, so
    // the client-side recompute (not a trusted stored value) is what fails.
    const tampered: ReplayBundle = {
      ...bundle,
      inputs_frozen: {
        ...bundle.inputs_frozen,
        market_usd: "1.05",
      },
    };
    stubFetchOnce(tampered);
    const user = userEvent.setup();
    render(<ReceiptVerifier alertId="test-alert" apiBase="https://api.test" />);

    await user.click(
      screen.getByRole("button", { name: /verify receipt hash in browser/i }),
    );

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/mismatch/i);
    });
    const text = screen.getByRole("status").textContent ?? "";
    expect(text.toLowerCase()).toContain("receipt returned by the api");
    expect(text.toLowerCase()).not.toContain("committed receipt");
  });

  it("a 429 reads as a calm pause, never the limit or the status code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response('{"error":"rate_limited","message":"60 requests a minute"}', {
          status: 429,
          headers: { "retry-after": "60" },
        }),
      ),
    );
    const user = userEvent.setup();
    const { container } = render(
      <ReceiptVerifier alertId="test-alert" apiBase="https://api.test" />,
    );
    await user.click(
      screen.getByRole("button", { name: /verify receipt hash in browser/i }),
    );
    await waitFor(() => {
      expect(container.textContent).toContain("Verification is paused");
    });
    expect(container.textContent ?? "").not.toMatch(
      /rate.?limit|requests a minute|429/i,
    );
  });
});
