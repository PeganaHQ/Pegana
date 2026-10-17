import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("EmbedClient API resolution", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("uses the production API on a Vercel preview host without an explicit base", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE", "");
    Object.defineProperty(window, "location", {
      value: {
        hostname: "pegana-abc123-lrafasouzas-projects.vercel.app",
        href: "https://pegana-abc123-lrafasouzas-projects.vercel.app/embed",
        origin: "https://pegana-abc123-lrafasouzas-projects.vercel.app",
      },
      writable: true,
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { EmbedClient } = await import(
      "@/app/(marketing)/embed/embed-client"
    );
    render(<EmbedClient />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.pegana.xyz/v1/assets",
        expect.any(Object),
      );
    });
  });
});
