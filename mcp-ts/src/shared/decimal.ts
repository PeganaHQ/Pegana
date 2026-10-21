// Decimal-string formatting that mirrors the REST contract.
//
// api-rs serializes every rust_decimal through `Decimal::normalize()`
// (crates/api-rs/src/serde_fmt.rs), so REST never emits trailing zeros:
// `0.000161`, not `0.000161000000000000000000`. Postgres NUMERIC columns also
// fix the scale REST shows: `discount_*` is NUMERIC(10,6) and the USD legs are
// NUMERIC(30,18) (migrations/0001_initial.sql). These helpers apply the same
// rules to MCP output, on strings, so no value goes through a lossy float.

const DECIMAL_RE = /^([+-]?)(\d*)(?:\.(\d*))?$/;

/** Strip trailing fractional zeros (and a bare trailing dot); `-0` -> `0`. */
export function normalizeDecimal(input: string): string {
  const m = DECIMAL_RE.exec(input.trim());
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) return input;
  const sign = m[1] === "-" ? "-" : "";
  const intPart = m[2]!.replace(/^0+(?=\d)/, "") || "0";
  const frac = (m[3] ?? "").replace(/0+$/, "");
  const body = frac ? `${intPart}.${frac}` : intPart;
  return body === "0" ? "0" : `${sign}${body}`;
}

/**
 * Round to `dp` fractional digits, half away from zero (Postgres NUMERIC
 * rounding, which is what a value stored in NUMERIC(p, dp) and read back by
 * REST went through), then normalize. Non-decimal input is returned as is.
 */
export function roundDecimal(input: string, dp: number): string {
  const m = DECIMAL_RE.exec(input.trim());
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) return input;
  const sign = m[1] === "-" ? "-" : "";
  const intPart = m[2] || "0";
  const frac = m[3] ?? "";
  if (frac.length <= dp) return normalizeDecimal(input);
  const kept = BigInt(intPart + frac.slice(0, dp));
  const roundUp = frac.charCodeAt(dp) >= "5".charCodeAt(0);
  const scaled = (roundUp ? kept + 1n : kept).toString().padStart(dp + 1, "0");
  const whole = scaled.slice(0, scaled.length - dp);
  const fraction = scaled.slice(scaled.length - dp);
  return normalizeDecimal(`${sign}${whole}${dp > 0 ? `.${fraction}` : ""}`);
}
