//! Thin RPC helpers: primary → fallback failover for account reads.
//!
//! The fallback branch is taken only on primary error or missing account entries.

use anyhow::{Context, Result};
use solana_rpc_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{account::Account, commitment_config::CommitmentConfig, pubkey::Pubkey};
use tracing::warn;

/// Strip query strings out of a rendered RPC error before it reaches the logs.
///
/// `solana_rpc_client_api`'s error is `#[error(transparent)]` over `reqwest::Error`, whose
/// `Display` renders `" for url (https://host/path?query)"` — and prod's
/// `SOLANA_RPC_URL` is a keyed Helius endpoint (`?api-key=...`). So `error = %e`
/// prints the live credential.
///
/// NOTE: `engine-rs`'s `mask_rpc_url()` is NOT reusable here. It masks a URL held
/// as a *variable*; at these call sites the URL is embedded inside the error's own
/// message, so the rendered string is what has to be redacted.
fn redact(err: impl std::fmt::Display) -> String {
    let s = err.to_string();
    let mut out = String::with_capacity(s.len());
    let mut rest = s.as_str();
    // Cut from each '?' to the next character that can't be part of a query
    // string, so multi-URL and trailing-context messages stay readable.
    while let Some(q) = rest.find('?') {
        out.push_str(&rest[..q]);
        out.push_str("?<redacted>");
        rest = match rest[q..].find([')', ' ', ',']) {
            Some(end) => &rest[q + end..],
            None => "",
        };
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod redact_tests {
    use super::redact;

    #[test]
    fn strips_api_key_from_a_reqwest_shaped_error() {
        let msg = "error sending request for url \
                   (https://mainnet.helius-rpc.com/?api-key=SECRET)";
        let got = redact(msg);
        assert!(!got.contains("SECRET"), "api key survived: {got}");
        assert!(got.contains("mainnet.helius-rpc.com"), "host lost: {got}");
        assert!(got.contains("?<redacted>)"), "context lost: {got}");
    }

    #[test]
    fn passes_through_when_there_is_no_query_string() {
        let msg = "error sending request for url (https://api.mainnet-beta.solana.com/)";
        assert_eq!(redact(msg), msg);
    }

    #[test]
    fn redacts_every_url_in_a_multi_url_message() {
        let got = redact("primary https://a.io/?api-key=AAA, fallback https://b.io/?api-key=BBB");
        assert!(!got.contains("AAA") && !got.contains("BBB"), "{got}");
    }
}

/// Try the primary RPC; on error, fall back to the secondary.
/// Zero overhead when primary is healthy.
pub async fn get_account_with_fallback(
    primary: &RpcClient,
    fallback: &RpcClient,
    pubkey: &Pubkey,
    label: &str,
) -> Result<Account> {
    match primary.get_account(pubkey).await {
        Ok(acc) => Ok(acc),
        Err(e) => {
            metrics::counter!("pegana_rpc_primary_failed_total", "source" => label.to_string())
                .increment(1);
            warn!(source = label, error = %redact(&e), "primary RPC failed — trying fallback");
            fallback
                .get_account(pubkey)
                .await
                .with_context(|| format!("getAccount {label} (fallback also failed)"))
        }
    }
}

/// Try a batched account read on the primary RPC; on error, fall back to the
/// secondary. Returns both account values and the RPC context slot.
pub async fn get_multiple_accounts_with_fallback(
    primary: &RpcClient,
    fallback: &RpcClient,
    pubkeys: &[Pubkey],
    label: &str,
) -> Result<(Vec<Option<Account>>, u64)> {
    match primary
        .get_multiple_accounts_with_commitment(pubkeys, CommitmentConfig::confirmed())
        .await
    {
        Ok(response) => {
            let primary_value = response.value;
            let primary_slot = response.context.slot;
            let missing_accounts = primary_value
                .iter()
                .filter(|account| account.is_none())
                .count();
            if missing_accounts == 0 {
                return Ok((primary_value, primary_slot));
            }

            metrics::counter!("pegana_rpc_primary_failed_total", "source" => label.to_string())
                .increment(1);
            warn!(
                source = label,
                missing_accounts, "primary RPC returned missing account(s) — trying fallback"
            );

            let fallback_response = match fallback
                .get_multiple_accounts_with_commitment(pubkeys, CommitmentConfig::confirmed())
                .await
            {
                Ok(response) => response,
                Err(e) => {
                    warn!(
                        source = label,
                        error = %redact(&e),
                        "fallback RPC failed after primary returned missing account(s) — keeping primary result"
                    );
                    return Ok((primary_value, primary_slot));
                }
            };
            let fallback_value = fallback_response.value;
            let fallback_slot = fallback_response.context.slot;

            match choose_more_complete_account_batch(&primary_value, &fallback_value) {
                AccountBatchChoice::Primary => Ok((primary_value, primary_slot)),
                AccountBatchChoice::Fallback => Ok((fallback_value, fallback_slot)),
            }
        }
        Err(e) => {
            metrics::counter!("pegana_rpc_primary_failed_total", "source" => label.to_string())
                .increment(1);
            warn!(source = label, error = %redact(&e), "primary RPC failed — trying fallback");
            let response = fallback
                .get_multiple_accounts_with_commitment(pubkeys, CommitmentConfig::confirmed())
                .await
                .with_context(|| format!("getMultipleAccounts {label} (fallback also failed)"))?;
            Ok((response.value, response.context.slot))
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AccountBatchChoice {
    Primary,
    Fallback,
}

fn choose_more_complete_account_batch(
    primary: &[Option<Account>],
    fallback: &[Option<Account>],
) -> AccountBatchChoice {
    if resolved_account_count(fallback) > resolved_account_count(primary) {
        AccountBatchChoice::Fallback
    } else {
        AccountBatchChoice::Primary
    }
}

fn resolved_account_count(accounts: &[Option<Account>]) -> usize {
    accounts.iter().filter(|account| account.is_some()).count()
}

/// Return the required account at a known `getMultipleAccounts` response index.
pub fn required_account<'a>(
    accounts: &'a [Option<Account>],
    index: usize,
    label: &str,
) -> Result<&'a Account> {
    accounts
        .get(index)
        .with_context(|| {
            format!(
                "getMultipleAccounts response missing {label} at index {index} ({} accounts returned)",
                accounts.len()
            )
        })?
        .as_ref()
        .with_context(|| format!("getAccount {label} returned no account"))
}

#[cfg(test)]
mod tests {
    use solana_sdk::{account::Account, pubkey::Pubkey};

    fn test_account(data: &[u8]) -> Account {
        Account {
            lamports: 1,
            data: data.to_vec(),
            owner: Pubkey::new_unique(),
            executable: false,
            rent_epoch: 0,
        }
    }

    #[test]
    fn required_account_maps_ordered_response_to_named_slots() {
        let accounts = vec![Some(test_account(&[1])), Some(test_account(&[2]))];

        let hyusd = super::required_account(&accounts, 0, "hyUSD").expect("hyUSD account");
        let xsol = super::required_account(&accounts, 1, "xSOL").expect("xSOL account");

        assert_eq!(hyusd.data, vec![1]);
        assert_eq!(xsol.data, vec![2]);
    }

    #[test]
    fn required_account_errors_on_none_with_label() {
        let accounts = vec![None];

        let err = super::required_account(&accounts, 0, "hylo_state").expect_err("missing account");

        assert_eq!(err.to_string(), "getAccount hylo_state returned no account");
    }

    #[test]
    fn required_account_errors_on_short_response_with_label_and_index() {
        let accounts = vec![Some(test_account(&[1]))];

        let err = super::required_account(&accounts, 1, "xSOL").expect_err("short response");

        assert_eq!(
            err.to_string(),
            "getMultipleAccounts response missing xSOL at index 1 (1 accounts returned)"
        );
    }

    #[test]
    fn account_batch_choice_keeps_primary_when_primary_resolves_all() {
        let primary = vec![Some(test_account(&[1])), Some(test_account(&[2]))];
        let fallback = vec![None, Some(test_account(&[9]))];

        assert_eq!(
            super::choose_more_complete_account_batch(&primary, &fallback),
            super::AccountBatchChoice::Primary
        );
    }

    #[test]
    fn account_batch_choice_uses_fallback_when_it_resolves_more_accounts() {
        let primary = vec![Some(test_account(&[1])), None];
        let fallback = vec![Some(test_account(&[1])), Some(test_account(&[2]))];

        assert_eq!(
            super::choose_more_complete_account_batch(&primary, &fallback),
            super::AccountBatchChoice::Fallback
        );
    }

    #[test]
    fn account_batch_choice_keeps_primary_when_missing_count_is_unchanged() {
        let primary = vec![Some(test_account(&[1])), None];
        let fallback = vec![Some(test_account(&[9])), None];

        assert_eq!(
            super::choose_more_complete_account_batch(&primary, &fallback),
            super::AccountBatchChoice::Primary
        );
    }

    /// Compile-level smoke test: ensure RPC helpers are reachable and the
    /// module compiles.  A live-RPC test is omitted because `RpcClient` does
    /// not expose a test-double constructor and spawning an actual validator
    /// in a unit-test is out of scope.
    #[test]
    fn module_compiles() {
        // Taking a raw function pointer proves the symbol exists and its
        // signature is consistent with what callers expect.  The cast is
        // intentionally avoided to keep the type simple.
        let _ = super::get_account_with_fallback as usize;
        let _ = super::get_multiple_accounts_with_fallback as usize;
    }
}
