//! Validation for asset-identifying path and query parameters.
//!
//! Every `{symbol}` / `{mint}` path parameter and the audit `?asset=` filter go
//! through here before touching Postgres. Without it a NUL byte in the path
//! (`/v1/assets/%00`) reached the query, Postgres rejected the string, and the
//! client got a 500 for its own malformed input.

use crate::error::ApiError;

/// Human description of the accepted symbol shape, used in error messages.
pub const SYMBOL_HINT: &str = "symbol must be 1-32 chars of [A-Za-z0-9._+*-]";

/// Human description of the accepted mint shape.
pub const MINT_HINT: &str = "mint must be a base58 Solana address (32-44 chars)";

/// Symbol charset: the tracked universe uses letters, digits, `.`, `_`, `-`,
/// plus `+` (`hyloSOL+`) and `*` (`USD*`). Case is not checked: symbol lookup
/// is case-insensitive.
pub fn is_valid_symbol(s: &str) -> bool {
    (1..=32).contains(&s.len())
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b'+' | b'*'))
}

/// Base58 (Bitcoin alphabet: no `0`, `O`, `I`, `l`), 32-44 chars, which covers
/// every 32-byte Solana public key.
pub fn is_valid_mint(s: &str) -> bool {
    (32..=44).contains(&s.len())
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() && !matches!(b, b'0' | b'O' | b'I' | b'l'))
}

/// `Err(400 invalid_asset)` unless `s` can be a symbol.
pub fn check_symbol(s: &str) -> Result<(), ApiError> {
    if is_valid_symbol(s) {
        Ok(())
    } else {
        Err(ApiError::invalid_asset(SYMBOL_HINT))
    }
}

/// `Err(400 invalid_asset)` unless `s` can be a mint.
pub fn check_mint(s: &str) -> Result<(), ApiError> {
    if is_valid_mint(s) {
        Ok(())
    } else {
        Err(ApiError::invalid_asset(MINT_HINT))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn symbols_in_the_universe_are_valid() {
        let raw = include_str!("../../../assets.toml");
        let af: pegana_common::AssetsFile = toml::from_str(raw).expect("assets.toml parses");
        for a in &af.assets {
            assert!(is_valid_symbol(&a.symbol), "symbol {:?}", a.symbol);
            assert!(is_valid_mint(&a.mint), "{} mint {:?}", a.symbol, a.mint);
        }
    }

    #[test]
    fn malformed_inputs_are_rejected() {
        for bad in ["", "\0", "US\0DC", "a b", "x/y", "%00", &"A".repeat(33)] {
            assert!(!is_valid_symbol(bad), "{bad:?}");
        }
        for bad in [
            "",
            "\0",
            "short",
            "0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl",
            &"1".repeat(45),
        ] {
            assert!(!is_valid_mint(bad), "{bad:?}");
        }
        assert!(check_symbol("US\0DC").is_err());
        assert!(check_mint("\0").is_err());
    }
}
