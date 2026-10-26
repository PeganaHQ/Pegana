pub mod dexscreener;
pub mod evm_nav;
pub mod fx_http;
pub mod hylo;
pub mod jupiter;
pub mod jupiter_perps;
pub mod lst_directory_audit;
pub mod nav_publish;
pub mod perena;
pub mod piggybank_pb;
pub mod pyth;
pub mod sanctum;
pub mod sanctum_nav;
pub mod solayer_susd;
pub mod spl_stake_pool;
pub mod token_supply;
pub mod tokens_xyz;
pub mod tokens_xyz_risk;

/// Floor for every source's poll cadence (`*_POLL_MS` env / config).
/// `tokio::time::interval` panics on a zero period, and a sub-second poll is a
/// misconfiguration for every upstream here, so a too-small value is raised
/// to this floor instead of crashing the source task.
pub const MIN_POLL_MS: u64 = 1000;

/// Apply [`MIN_POLL_MS`] to a configured poll cadence.
pub fn min_poll_ms(ms: u64) -> u64 {
    ms.max(MIN_POLL_MS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn poll_cadence_is_floored() {
        assert_eq!(min_poll_ms(0), MIN_POLL_MS);
        assert_eq!(min_poll_ms(999), MIN_POLL_MS);
        assert_eq!(min_poll_ms(60_000), 60_000);
        // The floored value is a valid tokio interval period (no panic).
        let _ = tokio::time::interval(std::time::Duration::from_millis(min_poll_ms(0)));
    }
}
