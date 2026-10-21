import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReceiptObjectV2 } from "@/components/organisms/v2/inner/receipt-object-v2";

describe("ReceiptObjectV2", () => {
  it("renders a real token icon when a mint is provided", () => {
    const { container } = render(
      <ReceiptObjectV2
        iconLabel="US"
        symbol="USDC"
        mint="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        klass="stable_fiat"
        transition={<span>Ready</span>}
        rows={[]}
      />,
    );

    expect(container.querySelector(".v2-in-tokico")).toBeNull();
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://api.pegana.xyz/static/tokens/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v.webp",
    );
  });
});
