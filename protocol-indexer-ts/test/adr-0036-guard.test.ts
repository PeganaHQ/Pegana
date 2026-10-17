import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ADR-0036 inv.1b — the CI guard (necessary AND sufficient). The Sub-C adapters
// MUST NOT link a position to an identity: no per-wallet/owner enumeration, and
// no read of an obligation's `owner`/`authority` field. Comments are stripped so
// documentation mentioning "owner" doesn't trip the check.

const FORBIDDEN: RegExp[] = [
  /ByWallet/, // getObligationByWallet / getAllUserObligationsByWallet etc.
  /getObligationByOwner/,
  /getAllUserObligations/,
  /getAllUserPositions/, // Jupiter Lend user-scoped enumeration — use vault-scoped batchGetUserPositions.
  /\.owner\b/,
  /\.authority\b/,
];

function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

describe("ADR-0036 inv.1b — Sub-C adapters never read wallet/owner identity", () => {
  const dir = join(process.cwd(), "src", "sources");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    it(`${f} contains no owner/wallet identity read`, () => {
      const code = stripComments(readFileSync(join(dir, f), "utf8"));
      for (const pat of FORBIDDEN) {
        expect(code, `${f} must not match ${pat}`).not.toMatch(pat);
      }
    });
  }
});

describe("ADR-0036 — the loop schema has no owner-capable column", () => {
  it("migration 0070 declares no owner/authority/wallet column", () => {
    const sql = readFileSync(join(process.cwd(), "..", "migrations", "0070_loop_intelligence.sql"), "utf8");
    // strip -- comments (which explain the invariant)
    const code = sql
      .split("\n")
      .map((l) => l.replace(/--.*$/, ""))
      .join("\n");
    for (const col of [/\bowner\b/i, /\bauthority\b/i, /\bwallet\b/i]) {
      expect(code, `migration must not declare a ${col} column`).not.toMatch(col);
    }
  });
});
