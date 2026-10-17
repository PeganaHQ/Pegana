// Bazaar discovery metadata, and the free-tier catalogue.
//
// Every tool is free, so nothing is charged and no 402 challenge is emitted.
// Two things still need pinning:
//   1. the discovery declarations stay VALID (they are kept for a future paid
//      tier), and
//   2. the catalogue every surface advertises is uniformly free — an agent
//      must never be told a tool costs money when it does not.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { validateDiscoveryExtension } from "@x402/extensions/bazaar";
import { FREE_PRICE, TOOL_CATALOG, toolCountSummary } from "@/pricing";
import {
  MCP_ENDPOINT,
  MCP_TRANSPORT,
  TOOL_DISCOVERY,
  inputSchemaToJson,
  toolResourceUrl,
} from "@/discovery";
import { getAssetHistoryTool } from "@/tools/get-asset-history";
import { subscribePegEventsTool } from "@/tools/subscribe-peg-events";

/** Pull the `bazaar` extension out of a declared payload. */
function bazaarOf(name: keyof typeof TOOL_DISCOVERY) {
  return TOOL_DISCOVERY[name].bazaar as {
    info: {
      input: {
        type: string;
        toolName: string;
        description?: string;
        transport?: string;
        inputSchema: Record<string, unknown>;
        example?: Record<string, unknown>;
      };
      output?: { example?: unknown };
    };
    schema: Record<string, unknown>;
  };
}

const DECLARED = Object.keys(TOOL_DISCOVERY).sort();

describe("discovery declarations stay valid", () => {
  it("declares the three formerly-metered tools", () => {
    expect(DECLARED).toEqual([
      "get_asset_history",
      "ping_paid",
      "subscribe_peg_events",
    ]);
  });

  it("names the tool it describes", () => {
    for (const name of DECLARED) {
      const bazaar = bazaarOf(name as keyof typeof TOOL_DISCOVERY);
      expect(bazaar.info.input.type).toBe("mcp");
      expect(bazaar.info.input.toolName).toBe(name);
    }
  });

  it("passes the Bazaar validator for every declaration", () => {
    for (const name of DECLARED) {
      const result = validateDiscoveryExtension(
        TOOL_DISCOVERY[name as keyof typeof TOOL_DISCOVERY].bazaar as never,
      );
      expect(result.valid, `${name}: ${result.errors?.join("; ")}`).toBe(true);
    }
  });

  it("rejects a payload whose transport is 'https'", () => {
    // Negative control: the validator accepts only streamable-http or sse, and
    // the emitted schema pins the declared value. Without this the tests above
    // could pass on a validator that accepts anything.
    const payload = structuredClone(TOOL_DISCOVERY.get_asset_history);
    const bazaar = payload.bazaar as { info: { input: { transport?: string } } };
    bazaar.info.input.transport = "https";

    const result = validateDiscoveryExtension(bazaar as never);
    expect(result.valid).toBe(false);
    expect(result.errors?.join(" ")).toMatch(/transport/);
  });

  it("rejects a payload with a missing inputSchema", () => {
    const payload = structuredClone(TOOL_DISCOVERY.ping_paid);
    const bazaar = payload.bazaar as { info: { input: Record<string, unknown> } };
    delete bazaar.info.input.inputSchema;

    expect(validateDiscoveryExtension(bazaar as never).valid).toBe(false);
  });

  it("uses a transport the validator accepts", () => {
    for (const name of DECLARED) {
      const bazaar = bazaarOf(name as keyof typeof TOOL_DISCOVERY);
      expect(bazaar.info.input.transport).toBe(MCP_TRANSPORT);
      expect(["streamable-http", "sse"]).toContain(bazaar.info.input.transport);
    }
  });

  it("derives the inputSchema from the live tool schema (no drift)", () => {
    expect(bazaarOf("get_asset_history").info.input.inputSchema).toEqual(
      inputSchemaToJson(getAssetHistoryTool.inputSchema),
    );
    expect(bazaarOf("subscribe_peg_events").info.input.inputSchema).toEqual(
      inputSchemaToJson(subscribePegEventsTool.inputSchema),
    );
    expect(
      bazaarOf("get_asset_history").info.input.inputSchema.$schema,
    ).toBeUndefined();
  });

  it("includes an example request and response", () => {
    for (const name of DECLARED) {
      const bazaar = bazaarOf(name as keyof typeof TOOL_DISCOVERY);
      expect(bazaar.info.input.example, `${name} example`).toBeDefined();
      expect(bazaar.info.output?.example, `${name} output`).toBeDefined();
    }
  });
});

describe("free tier: nothing is charged", () => {
  it("catalogues every tool at the free price", () => {
    expect(TOOL_CATALOG.length).toBeGreaterThan(0);
    for (const entry of TOOL_CATALOG) {
      expect(entry.price, `${entry.name} must be free`).toBe(FREE_PRICE);
    }
  });

  it("includes the three tools that used to be metered", () => {
    const names = TOOL_CATALOG.map((t) => t.name);
    for (const n of ["ping_paid", "get_asset_history", "subscribe_peg_events"]) {
      expect(names).toContain(n);
    }
  });

  it("summarises the catalogue as a free count", () => {
    expect(toolCountSummary()).toBe(`${TOOL_CATALOG.length} free`);
  });

  it("has no payment machinery anywhere in src", () => {
    // Source guard across the WHOLE source tree, not just server.ts: a wrapper
    // or a payTo address anywhere would mean some tool can take money, which
    // the free-tier contract forbids. (Scoped to server.ts this could be
    // bypassed by putting the wrapper in a new file.)
    const files = readdirSync(join(process.cwd(), "src"), {
      recursive: true,
      encoding: "utf8",
    }).filter((f) => f.endsWith(".ts"));

    // Comments may legitimately NAME the old machinery (to explain why a
    // branch exists), so strip them: only executable code counts.
    const stripComments = (src: string) =>
      src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "")
        .replace(/([^:])\/\/.*$/gm, "$1");

    expect(files.length).toBeGreaterThan(5);
    for (const rel of files) {
      const code = stripComments(
        readFileSync(join(process.cwd(), "src", rel), "utf8"),
      );
      for (const needle of [
        "createPaymentWrapper",
        "buildPaymentRequirements",
        "PEGANA_PAYTO_USDC",
        "CDP_API_KEY",
      ]) {
        expect(code.includes(needle), `${rel} still references ${needle}`).toBe(
          false,
        );
      }
    }
  });
});

describe("resource URLs", () => {
  it("are absolute https on the public host, one per tool", () => {
    const urls = DECLARED.map((n) => toolResourceUrl(n));
    for (const url of urls) {
      const parsed = new URL(url);
      expect(parsed.protocol).toBe("https:");
      expect(parsed.origin).toBe("https://mcp.pegana.xyz");
    }
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("keeps the configured endpoint and adds the tool path", () => {
    expect(MCP_ENDPOINT).toBe("https://mcp.pegana.xyz");
    expect(toolResourceUrl("ping_paid")).toBe(
      "https://mcp.pegana.xyz/tool/ping_paid",
    );
  });
});
