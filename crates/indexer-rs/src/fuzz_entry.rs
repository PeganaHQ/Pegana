//! Entry points shared by the `cargo-fuzz` targets (`fuzz/`) and an in-tree smoke
//! test. Every function here must return — never panic — for ANY input: the
//! decoders parse bytes and JSON that come from upstream services or on-chain
//! accounts we do not control.

use solana_sdk::account::Account;
use solana_sdk::pubkey::Pubkey;

use crate::sources::{
    evm_nav, fx_http, hylo, jupiter_perps, perena, piggybank_pb, pyth, sanctum_nav, solayer_susd,
    spl_stake_pool, token_supply,
};

/// Feed raw account bytes to every on-chain decoder.
pub fn decoders(data: &[u8]) {
    let mint = Pubkey::new_from_array([7; 32]);
    let _ = perena::decode_vault(data);
    let _ = piggybank_pb::decode_nav(data);
    let _ = spl_stake_pool::decode_nav_sol(data, &mint);
    let _ = jupiter_perps::decode_pool(data);
    let _ = jupiter_perps::decode_spl_mint(data);
    let _ = solayer_susd::decode_nav(data, 1_700_000_000);
    let _ = token_supply::decode_mint_supply(data);
    let _ = sanctum_nav::decode_marinade_nav(data, &mint);
    let _ = sanctum_nav::decode_scontroller_nav(data, data, &mint);
    let _ = pyth::decode_price_update(data, &[3; 32]);
    // Reach the success branch too: the account embeds its own feed id.
    if data.len() >= 73 {
        let mut feed = [0u8; 32];
        feed.copy_from_slice(&data[41..73]);
        let _ = pyth::decode_price_update(data, &feed);
    }
    // Every configured on-chain NAV spec, fed the same bytes for each account.
    for spec in sanctum_nav::ONCHAIN_SPECS {
        if let Ok(keys) = spec.accounts() {
            let accounts: Vec<(Pubkey, &[u8])> = keys.into_iter().map(|k| (k, data)).collect();
            let _ = sanctum_nav::decode_onchain_nav(spec, &accounts);
        }
    }
    let account = Account {
        data: data.to_vec(),
        ..Account::default()
    };
    let _ = hylo::decode_mint_supply(&account, "fuzz");
    let _ = hylo::decode_token_account_amount(&account, &mint);
    let _ = hylo::decode_hylo_total_sol(&account);
}

/// Feed arbitrary JSON / text to the HTTP and RPC response parsers.
pub fn parsers(data: &[u8]) {
    if let Ok(json) = serde_json::from_slice::<serde_json::Value>(data) {
        let _ = fx_http::parse_kraken(&json);
        let _ = fx_http::parse_coinbase(&json, "EUR", "USD");
        let _ = evm_nav::parse_block(&json);
        let targets = [evm_nav::EvmTarget {
            symbol: "FUZZ".into(),
            contract: "0x0".into(),
            calldata: "0x".into(),
            decimals: 18,
            max_divergence_bps: 50,
            max_block_age_secs: 600,
        }];
        let _ = evm_nav::parse_calls(&json, &targets);
    }
    if let Ok(text) = std::str::from_utf8(data) {
        let _ = evm_nav::parse_hex_u64(text);
        let _ = evm_nav::decode_uint256_scaled(text, 18);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }
        fn below(&mut self, n: usize) -> usize {
            (self.next() as usize) % n.max(1)
        }
    }

    /// Every base64 account blob inside a recorded RPC fixture.
    fn blobs(value: &serde_json::Value, out: &mut Vec<Vec<u8>>) {
        match value {
            serde_json::Value::Array(items) => {
                if let [serde_json::Value::String(b64), serde_json::Value::String(enc)] =
                    items.as_slice()
                {
                    if enc == "base64" {
                        if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(b64) {
                            out.push(bytes);
                        }
                    }
                }
                items.iter().for_each(|v| blobs(v, out));
            }
            serde_json::Value::Object(map) => map.values().for_each(|v| blobs(v, out)),
            _ => {}
        }
    }

    fn fixture_accounts() -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        for dir in std::fs::read_dir("fixtures")
            .into_iter()
            .flatten()
            .flatten()
        {
            for file in std::fs::read_dir(dir.path())
                .into_iter()
                .flatten()
                .flatten()
            {
                if let Ok(text) = std::fs::read_to_string(file.path()) {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                        blobs(&json, &mut out);
                    }
                }
            }
        }
        out
    }

    /// Mutations of real accounts reach the deep parsing code (valid
    /// discriminator/owner prefix) that pure random bytes never do.
    #[test]
    fn mutated_recorded_accounts_never_panic_a_decoder() {
        let accounts = fixture_accounts();
        assert!(!accounts.is_empty(), "fixtures must provide account bytes");
        let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
        for account in &accounts {
            decoders(account);
            // Every truncation length.
            for len in 0..account.len().min(600) {
                decoders(&account[..len]);
            }
            for _ in 0..300 {
                let mut data = account.clone();
                for _ in 0..=rng.below(6) {
                    let at = rng.below(data.len());
                    match rng.below(3) {
                        0 => data[at] ^= 1 << rng.below(8),
                        1 => data[at] = rng.next() as u8,
                        _ => data[at] = [0x00, 0xff][rng.below(2)],
                    }
                }
                if rng.below(4) == 0 {
                    data.truncate(rng.below(data.len() + 1));
                }
                decoders(&data);
            }
        }
    }

    /// Discriminator + random tail at, around and above each decoder's minimum
    /// length, for the accounts with no recorded fixture (Pyth, Hylo, Marinade).
    #[test]
    fn known_discriminators_with_random_tails_never_panic() {
        let discs: [&[u8]; 4] = [
            &[0x22, 0xf1, 0x23, 0x63, 0x9d, 0x7e, 0xf4, 0xcd],
            &[114, 161, 169, 210, 204, 175, 149, 174],
            &[0xd8, 0x92, 0x6b, 0x5e, 0x68, 0x4b, 0xb6, 0xb1],
            b"PBKTOKEN",
        ];
        let mut rng = Rng(0xD1B5_4A32_D192_ED03);
        for disc in discs {
            for len in [8usize, 40, 41, 133, 134, 200, 304, 321, 322, 500, 1_000] {
                for _ in 0..100 {
                    let mut data: Vec<u8> = (0..len).map(|_| rng.next() as u8).collect();
                    data[..disc.len().min(len)].copy_from_slice(&disc[..disc.len().min(len)]);
                    if disc.len() == 8 && len > 40 {
                        data[40] = 1; // verification level `Full` for the Pyth discriminator
                    }
                    decoders(&data);
                }
            }
        }
    }

    fn random_decimal(rng: &mut Rng) -> String {
        match rng.below(6) {
            0 => format!("{}.{}", rng.next(), rng.next()),
            1 => "79228162514264337593543950335".into(),
            2 => "-0.0000000000000000000000000001".into(),
            3 => "1e999".into(),
            4 => String::new(),
            _ => format!("{}", rng.next() as i64),
        }
    }

    fn random_hex(rng: &mut Rng) -> String {
        let len = rng.below(90);
        let body: String = (0..len)
            .map(|_| b"0123456789abcdefABCDEFxg"[rng.below(24)] as char)
            .collect();
        if rng.below(2) == 0 {
            format!("0x{body}")
        } else {
            body
        }
    }

    /// Valid-shaped Kraken / Coinbase / EVM payloads with hostile field values.
    #[test]
    fn well_formed_payloads_with_hostile_values_never_panic_a_parser() {
        let mut rng = Rng(0xA076_1D64_78BD_642F);
        for _ in 0..600 {
            let kraken = serde_json::json!({"error": [], "result": {"X": {
                "a": [random_decimal(&mut rng)], "b": [random_decimal(&mut rng)]}}});
            let coinbase = serde_json::json!({"data": {"currency": "EUR",
                "rates": {"USD": random_decimal(&mut rng)}}});
            let block = serde_json::json!({"result": {
                "number": random_hex(&mut rng), "timestamp": random_hex(&mut rng)}});
            let calls = serde_json::json!([
                {"id": 1, "result": random_hex(&mut rng)},
                {"id": rng.below(4), "error": {"code": -1, "message": "x"}},
            ]);
            for json in [kraken, coinbase, block, calls] {
                parsers(json.to_string().as_bytes());
            }
            parsers(random_hex(&mut rng).as_bytes());
        }
    }

    /// Plain random bytes still must not panic.
    #[test]
    fn pseudo_random_bytes_never_panic_anything() {
        let mut rng = Rng(0x2545_F491_4F6C_DD1D);
        for _ in 0..400 {
            let len = rng.below(2_048);
            let data: Vec<u8> = (0..len).map(|_| rng.next() as u8).collect();
            decoders(&data);
            parsers(&data);
        }
    }
}
