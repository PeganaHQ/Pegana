// Regenerate src/shared/asset-registry.ts from the repo-root assets.toml.
//
//   cd mcp-ts && bun run scripts/gen-asset-registry.ts
//
// The drift test (test/unit/asset-registry.test.ts) fails whenever the two
// disagree, so run this after any assets.toml edit that touches symbol,
// class, peg_target, active, intrinsic or market.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAssetsToml } from "./assets-toml";

const here = dirname(fileURLToPath(import.meta.url));
const tomlPath = resolve(here, "../../assets.toml");
const outPath = resolve(here, "../src/shared/asset-registry.ts");

const entries = parseAssetsToml(readFileSync(tomlPath, "utf8"));
const current = readFileSync(outPath, "utf8");
const marker = "// @generated-entries";
const start = current.indexOf(marker);
const end = current.indexOf("// @end-generated-entries");
if (start < 0 || end < 0) throw new Error("generation markers not found");

const body = entries.map((e) => `  ${JSON.stringify(e)},`).join("\n");
const next =
  current.slice(0, start + marker.length) + "\n" + body + "\n  " + current.slice(end);
writeFileSync(outPath, next);
console.log(`wrote ${entries.length} entries to ${outPath}`);
