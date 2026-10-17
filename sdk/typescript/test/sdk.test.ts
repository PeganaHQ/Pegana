// Offline regression tests for the hand-rolled SDK. No network — every call
// goes through an injected mock `fetch` that returns frozen fixtures shaped
// EXACTLY like the live API (crates/api-rs/src/routes/audit.rs).
//
// Run with: `bun test` (bun:test is bundled with bun, no install needed).
//
// Locks two launch-blocker regressions:
//   B-012 — verifyAlert must read the NESTED receipt.evidence.receipt_sha256,
//           not a flat top-level field (else every verify returned ok:false).
//   B-028 — OnchainCommitment is { tx_sig, explorer_url, commit_status } with
//           NO phantom `cluster` (nor alert_id / memo_format) field, and the
//           route 404s for non-committed alerts (getOnchain → null).

import { describe, expect, it } from "bun:test";
import {
  PeganaClient,
  type AuditReceipt,
  type OnchainCommitment,
} from "../src/index.ts";

const ALERT_ID = "4cf3a1d2-7e9b-4b3a-9a7c-9d1e2f3b4c5d";
const RECEIPT_SHA =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

// Live nested /v1/audit/{id} body (audit.rs:174-205).
const AUDIT_FIXTURE: AuditReceipt = {
  alert: {
    id: ALERT_ID,
    asset: "USDC",
    class: "stablecoin",
    from_state: "PEGGED",
    to_state: "DRIFT",
    discount: "0.0021",
    intrinsic_usd: "1.0000",
    market_usd: "0.9979",
    confidence: "high",
    detected_at: "2026-05-31T12:00:00Z",
  },
  evidence: {
    methodology_version: "0.4.2",
    methodology_git_sha: "deadbeef",
    assets_toml_sha256: "abc123",
    has_replay_artifact: true,
    receipt_sha256: RECEIPT_SHA,
    onchain_tx_sig: null,
    created_at: "2026-05-31T12:00:01Z",
  },
  evidence_status: "ready",
};

// Live committed /onchain 200 body (audit.rs:444-449). Note: tx_sig,
// explorer_url, commit_status — and nothing else.
const ONCHAIN_COMMITTED = {
  tx_sig: "4XLXT3vSabc",
  explorer_url: "https://solscan.io/tx/4XLXT3vSabc",
  commit_status: "committed",
};

// Live 404 body for a non-committed alert (audit.rs:430-438 / 489-497).
const ONCHAIN_404 = {
  error: "not_applicable",
  commit_status: "not_applicable",
  detail: "No on-chain anchor for this alert.",
  alert_id: ALERT_ID,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Build a client wired to a route → fixture map, no network. */
function clientWith(routes: Record<string, Response | (() => Response)>) {
  const fetchMock: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = new URL(url).pathname;
    const hit = routes[path];
    if (!hit) return jsonResponse({ error: "not_found" }, 404);
    return typeof hit === "function" ? hit() : hit;
  };
  return new PeganaClient({ fetch: fetchMock });
}

describe("verifyAlert (B-012 regression)", () => {
  it("parses the NESTED receipt.evidence.receipt_sha256 and matches", async () => {
    const c = clientWith({
      [`/v1/audit/${ALERT_ID}`]: () => jsonResponse(AUDIT_FIXTURE),
    });
    const v = await c.verifyAlert(ALERT_ID, RECEIPT_SHA);
    expect(v.ok).toBe(true);
    expect(v.actual).toBe(RECEIPT_SHA);
    expect(v.expected).toBe(RECEIPT_SHA);
    expect(v.alert_id).toBe(ALERT_ID);
  });

  it("reports ok:false on a sha mismatch (not a crash)", async () => {
    const c = clientWith({
      [`/v1/audit/${ALERT_ID}`]: () => jsonResponse(AUDIT_FIXTURE),
    });
    const v = await c.verifyAlert(ALERT_ID, "0".repeat(64));
    expect(v.ok).toBe(false);
    expect(v.actual).toBe(RECEIPT_SHA);
    expect(v.status).toBe("ready"); // ready + mismatch = a real tamper signal
  });

  it("distinguishes a PENDING receipt from a tamper (ok:false, status:pending)", async () => {
    // A not-yet-materialized receipt: no evidence sha. Must NOT read as ok:false
    // === tampered — callers branch on `status` to tell "not ready" from "wrong".
    const pending = { evidence: null, evidence_status: "pending" };
    const c = clientWith({
      [`/v1/audit/${ALERT_ID}`]: () => jsonResponse(pending),
    });
    const v = await c.verifyAlert(ALERT_ID, RECEIPT_SHA);
    expect(v.ok).toBe(false);
    expect(v.status).toBe("pending");
    expect(v.actual).toBe("");
  });

  it("getAudit returns the nested envelope, sha lives under evidence", async () => {
    const c = clientWith({
      [`/v1/audit/${ALERT_ID}`]: () => jsonResponse(AUDIT_FIXTURE),
    });
    const r = await c.getAudit(ALERT_ID);
    expect(r.alert.id).toBe(ALERT_ID);
    expect(r.evidence.receipt_sha256).toBe(RECEIPT_SHA);
    // B-012: there is NO flat top-level receipt_sha256.
    expect((r as Record<string, unknown>).receipt_sha256).toBeUndefined();
  });
});

describe("getOnchain (B-028 regression)", () => {
  it("returns the live { tx_sig, explorer_url, commit_status } body — and no phantom `cluster`", async () => {
    const c = clientWith({
      [`/v1/audit/${ALERT_ID}/onchain`]: () => jsonResponse(ONCHAIN_COMMITTED),
    });
    const oc = await c.getOnchain(ALERT_ID);
    expect(oc).not.toBeNull();
    const committed = oc as OnchainCommitment;
    expect(committed.tx_sig).toBe(ONCHAIN_COMMITTED.tx_sig);
    expect(committed.explorer_url).toBe(ONCHAIN_COMMITTED.explorer_url);
    expect(committed.commit_status).toBe("committed");
    // B-028: the live response has no `cluster` (nor alert_id / memo_format).
    const keys = Object.keys(committed);
    expect(keys).not.toContain("cluster");
    expect(keys).not.toContain("alert_id");
    expect(keys).not.toContain("memo_format");
    expect(keys.sort()).toEqual(
      ["commit_status", "explorer_url", "tx_sig"].sort(),
    );
  });

  it("resolves to null on a 404 (the common, non-anchored case) instead of throwing", async () => {
    const c = clientWith({
      [`/v1/audit/${ALERT_ID}/onchain`]: () => jsonResponse(ONCHAIN_404, 404),
    });
    const oc = await c.getOnchain(ALERT_ID);
    expect(oc).toBeNull();
  });

  it("still throws on a non-404 server error", async () => {
    const c = clientWith({
      [`/v1/audit/${ALERT_ID}/onchain`]: () =>
        jsonResponse({ error: "boom" }, 500),
    });
    await expect(c.getOnchain(ALERT_ID)).rejects.toThrow();
  });
});
