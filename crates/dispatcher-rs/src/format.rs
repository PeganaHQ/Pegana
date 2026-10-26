//! Canonical wire labels for alert payloads.

use pegana_common::PegState;

/// Canonical wire label for a peg state. This is the ONE source of truth for the
/// public string form — matching the docs, the API schema, and the web type
/// (`PEGGED | DRIFT | DEPEG | CRITICAL | BLACK_SWAN | UNKNOWN`). NOTE it deliberately
/// differs from `common_verify::PegState`'s serde `rename_all = "UPPERCASE"` (which
/// emits `BLACKSWAN`, no underscore, and is frozen into the byte-exact receipt hash):
/// never serialize a `PegState` directly into a public/webhook payload — go through
/// this so `BLACK_SWAN` carries its underscore.
pub(crate) fn label(s: PegState) -> &'static str {
    match s {
        PegState::Pegged => "PEGGED",
        PegState::Drift => "DRIFT",
        PegState::Depeg => "DEPEG",
        PegState::Critical => "CRITICAL",
        PegState::BlackSwan => "BLACK_SWAN",
        PegState::Unknown => "UNKNOWN",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blacks_wan_keeps_its_underscore() {
        // The receipt hash uses "BLACKSWAN"; the public wire label must not.
        assert_eq!(label(PegState::BlackSwan), "BLACK_SWAN");
        assert_eq!(label(PegState::Pegged), "PEGGED");
        assert_eq!(label(PegState::Drift), "DRIFT");
        assert_eq!(label(PegState::Depeg), "DEPEG");
        assert_eq!(label(PegState::Critical), "CRITICAL");
        assert_eq!(label(PegState::Unknown), "UNKNOWN");
    }
}
