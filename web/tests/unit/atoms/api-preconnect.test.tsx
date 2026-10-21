import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

const preconnect = vi.fn();
vi.mock("react-dom", async (orig) => ({
  ...(await orig<typeof import("react-dom")>()),
  preconnect: (...a: unknown[]) => preconnect(...a),
}));

import { ApiPreconnect } from "@/components/atoms/api-preconnect";
import { apiBase } from "@/lib/api/base";

describe("ApiPreconnect", () => {
  it("preconnects to the API origin with the CORS (anonymous) credential mode", () => {
    render(<ApiPreconnect />);
    expect(preconnect).toHaveBeenCalledWith(apiBase(), {
      crossOrigin: "anonymous",
    });
  });
});
