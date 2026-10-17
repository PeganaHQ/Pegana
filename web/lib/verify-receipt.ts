// Pure browser-safe receipt verifier.
//
// Reproduces in JavaScript exactly what `crates/methodology/src/canonical.rs`
// does in Rust — re-hashing a replay bundle's frozen bytes and comparing
// against `expected_receipt_sha256` — so a non-engineer can verify a receipt
// with one click, no CLI install.
//
// Algorithm: sha256 of these UTF-8 byte segments concatenated, with a single
// 0x00 byte BETWEEN segments (no trailing 0x00):
//
//   utf8(methodology_version) ‖ 0x00 ‖ utf8(methodology_git_sha ?? "")
//   ‖ 0x00 ‖ utf8(assets_toml_canonical)
//   ‖ 0x00 ‖ utf8(JCS(inputs_frozen))
//   ‖ 0x00 ‖ utf8(JCS(expected_computed))
//
// JCS = RFC 8785 JSON Canonicalization Scheme: recursively sort object keys by
// UTF-16 code unit, no whitespace, standard JSON string escaping. Numbers that
// are plain integers (e.g. confirm_up_secs, thresholds values) serialize as
// bare integers. All Decimal fields are already JSON strings in the bundle.

export type ReplayBundle = {
  schema_version: string;
  methodology_version: string;
  methodology_git_sha: string | null;
  assets_toml_canonical: string;
  inputs_frozen: Record<string, unknown>;
  expected_computed: Record<string, unknown>;
  expected_receipt_sha256: string;
};

export type VerifyResult =
  | { ok: true; recomputed: string; expected: string }
  | { ok: false; recomputed: string; expected: string };

// ---------------------------------------------------------------------------
// RFC 8785 JSON Canonicalization Scheme (JCS)
// ---------------------------------------------------------------------------

/**
 * Serialize a value to its RFC 8785 canonical JSON form.
 *
 * Rules:
 * - Object keys sorted lexicographically by UTF-16 code units (for pure-ASCII
 *   keys this equals standard Unicode sort order).
 * - No whitespace.
 * - Strings use standard JSON escaping (\", \\, \n, \r, \t, \b, \f, \uXXXX
 *   for control chars < 0x20).
 * - Numbers: bare integers for integer-typed values; should not encounter
 *   floats in this domain (all Decimal fields come in as strings).
 * - null, true, false: as-is.
 * - Arrays: items in original order.
 */
export function jcsSerialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Non-finite number in JCS input: ${value}`);
    }
    // Serialize as integer if it is a safe integer, otherwise as JSON number.
    // In practice all numbers in our bundles are safe integers (thresholds, etc).
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return jcsStringEscape(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(jcsSerialize).join(",") + "]";
  }
  if (typeof value === "object") {
    // Sort keys by UTF-16 code unit comparison (String.prototype.localeCompare
    // is locale-sensitive; use < / > directly on JS strings which use UTF-16).
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
    );
    return (
      "{" +
      entries
        .map(([k, v]) => jcsStringEscape(k) + ":" + jcsSerialize(v))
        .join(",") +
      "}"
    );
  }
  // undefined, function, symbol — should not appear in a parsed JSON bundle
  throw new TypeError(`Unexpected value type in JCS input: ${typeof value}`);
}

/**
 * Produce a properly-escaped JSON string literal (with surrounding quotes).
 * Handles the six named escapes plus \uXXXX for control characters < 0x20.
 */
function jcsStringEscape(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const code = s.charCodeAt(i);
    if (c === '"') {
      out += '\\"';
    } else if (c === "\\") {
      out += "\\\\";
    } else if (c === "\n") {
      out += "\\n";
    } else if (c === "\r") {
      out += "\\r";
    } else if (c === "\t") {
      out += "\\t";
    } else if (c === "\b") {
      out += "\\b";
    } else if (c === "\f") {
      out += "\\f";
    } else if (code < 0x20) {
      out += "\\u" + code.toString(16).padStart(4, "0");
    } else {
      out += c;
    }
  }
  return out + '"';
}

// ---------------------------------------------------------------------------
// SHA-256 via Web Crypto (works in browsers AND Node 18+ / jsdom + vitest)
// ---------------------------------------------------------------------------

async function sha256Hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Re-compute the receipt hash from a replay bundle in exactly the same way the
 * Rust engine does. Returns the lowercase hex-encoded SHA-256.
 */
export async function recomputeReceiptSha256(
  bundle: ReplayBundle,
): Promise<string> {
  const enc = new TextEncoder();
  const sep = new Uint8Array([0x00]);

  const segments: Uint8Array[] = [
    enc.encode(bundle.methodology_version),
    sep,
    enc.encode(bundle.methodology_git_sha ?? ""),
    sep,
    enc.encode(bundle.assets_toml_canonical),
    sep,
    enc.encode(jcsSerialize(bundle.inputs_frozen)),
    sep,
    enc.encode(jcsSerialize(bundle.expected_computed)),
  ];

  // Concatenate all segments into one buffer.
  const totalLen = segments.reduce((n, s) => n + s.length, 0);
  const ab = new ArrayBuffer(totalLen);
  const buf = new Uint8Array(ab);
  let offset = 0;
  for (const seg of segments) {
    buf.set(seg, offset);
    offset += seg.length;
  }

  return sha256Hex(new Uint8Array(ab));
}

/**
 * Hash self-consistency check: re-hash the frozen bundle bytes and compare
 * to the `expected_receipt_sha256` the API returned alongside them.
 *
 * SCOPE: this proves the bundle's fields are internally consistent with the
 * hash the server returned — it does NOT prove the server didn't serve a
 * different, equally self-consistent bundle instead (that requires the
 * on-chain SPL Memo anchor check, which the CLI performs by default via
 * `pegana-replay --alert-id <id>` but which this in-browser widget does
 * NOT attempt — no RPC call is made here, and none is planned). It also
 * does NOT re-derive the verdict from raw oracle inputs — that would
 * require re-running the full engine logic in the browser, which is on the
 * roadmap but not implemented here. For the strongest available guarantee,
 * use the CLI's default (online) mode, not this widget.
 */
export async function verifyReceipt(
  bundle: ReplayBundle,
): Promise<VerifyResult> {
  const recomputed = await recomputeReceiptSha256(bundle);
  const expected = bundle.expected_receipt_sha256;
  return { ok: recomputed === expected, recomputed, expected };
}
