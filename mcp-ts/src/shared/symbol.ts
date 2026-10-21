// Shared input schema for asset-symbol arguments.
//
// The charset mirrors api-rs `is_valid_symbol` (crates/api-rs/src/params.rs);
// the length cap stays at 20 (api-rs allows 1-32), unchanged from the previous
// MCP max. The tracked universe only uses letters, digits, `.`, `_`, `-`, `+` (`hyloSOL+`) and `*`
// (`USD*`). Validating the charset at the schema boundary means a NUL byte or
// other junk never reaches Postgres (whose raw error text used to come back to
// the caller, R2 audit idx 54) or an upstream URL.

import { z } from "zod";

export const SYMBOL_MAX_LEN = 20;
export const SYMBOL_PATTERN = /^[A-Za-z0-9._+*-]+$/;
export const SYMBOL_HINT = `symbol must be 1-${SYMBOL_MAX_LEN} chars of [A-Za-z0-9._+*-]`;

/** A case-sensitive asset symbol argument. Callers add `.describe(...)`. */
export function symbolSchema() {
  return z
    .string()
    .min(1, { message: SYMBOL_HINT })
    .max(SYMBOL_MAX_LEN, { message: SYMBOL_HINT })
    .regex(SYMBOL_PATTERN, { message: SYMBOL_HINT });
}
