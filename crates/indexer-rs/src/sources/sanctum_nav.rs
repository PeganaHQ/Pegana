//! On-chain NAV for the LSTs priced through the Sanctum `sol-value` API, plus the
//! drift guard that decides whether the API value may be published.
//!
//! Why this exists (2026-10-19): `extra-api.sanctum.so/v1/sol-value/current`
//! served NAVs ~2.3% below the on-chain truth for 38 of 43 LSTs (jitoSOL API
//! 1.2759 vs pool 1.3077 vs Jupiter market 1.3057), so every one of them read
//! "market above intrinsic" and was classified PEGGED. The five LSTs already
//! read directly from their stake pool (`sources::spl_stake_pool`) were fine.
//! This module extends the direct on-chain read to the Sanctum-path LSTs.
//!
//! Layouts (all verified against mainnet accounts on 2026-10-20):
//! * SPL stake pool (programs `SPoo1Ku8` Spl, `SP12tWFx` SanctumSpl,
//!   `SPMBzsVU` SanctumSplMulti; identical header): NAV =
//!   `total_lamports / pool_token_supply`, decoded by
//!   `spl_stake_pool::decode_nav_sol` (which also checks `pool_mint`).
//! * Marinade mSOL (`MarBmsSg` state, Anchor): `msol_mint` @8, `msol_supply`
//!   @504, `msol_price` @512 (u64, 32-bit fixed point: NAV = price / 2^32).
//! * Sanctum Infinity INF (S Controller `5ocnV1qi` PoolState, 240 B):
//!   `total_sol_value` u64 @0, `lp_token_mint` @144; NAV = total_sol_value /
//!   INF mint supply (SPL mint `supply` u64 @36).
//!
//! Policy (`decide`): an on-chain NAV, when readable, is ALWAYS the published
//! intrinsic (deterministic: no flapping between two sources that differ by a
//! structural haircut); the API value is only compared against it so a >1%
//! disagreement is loud (WARN + counter). Without an on-chain read the API value
//! is checked against the Jupiter market-implied NAV and, when it sits more than
//! `NAV_MAX_DRIFT_BPS` BELOW the market (the 2026-10-19 failure signature), it
//! is withheld and the asset is flagged `intrinsic_liveness.stale`. The guard
//! FAILS CLOSED: if neither an on-chain NAV nor a market reference is available
//! for an active LST (RPC and market query both down), the API value cannot be
//! verified, so it is withheld too (`Unverified`, reason `sanctum_nav_unverified`)
//! rather than published as fresh. Inactive assets are never withheld.

use crate::sources::spl_stake_pool;
use anyhow::{ensure, Context, Result};
use rust_decimal::Decimal;
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;

/// Max tolerated disagreement (bps, = 1%) between the Sanctum API NAV and the
/// reference (on-chain NAV, else Jupiter market-implied NAV). Default for the
/// `SANCTUM_NAV_DRIFT_BPS` override (`Config::sanctum_nav_drift_bps`).
pub const NAV_MAX_DRIFT_BPS: i64 = 100;

/// `intrinsic_liveness.reason` written when the API NAV is withheld because it
/// sits far below the market.
pub const LIVENESS_REASON: &str = "sanctum_nav_drift";
/// `intrinsic_liveness.reason` written when the API NAV is withheld because it
/// could not be verified at all (no on-chain read AND no market reference).
pub const LIVENESS_REASON_UNVERIFIED: &str = "sanctum_nav_unverified";

pub const SPL_STAKE_POOL_PROGRAMS: [&str; 3] = [
    "SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy", // Spl
    "SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY", // SanctumSpl
    "SPMBzsVUuoHA4Jm6KunbsotaahvVikZs1JyTW6iJvbn", // SanctumSplMulti
];
const MARINADE_PROGRAM: &str = "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD";
const MARINADE_STATE: &str = "8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC";
const S_CONTROLLER_PROGRAM: &str = "5ocnV1qiCgaQR8Jb8xWnVbApfaygJ8tNoZfgPwsgx9kx";
const S_CONTROLLER_POOL_STATE: &str = "AYhux5gJzCoeoc1PoJ1VxwPDe22RwcvpHviLDD1oCGvW";

/// Anchor discriminator of Marinade's `State` account (sha256("account:State")[..8]).
const MARINADE_STATE_DISC: [u8; 8] = [0xd8, 0x92, 0x6b, 0x5e, 0x68, 0x4b, 0xb6, 0xb1];
const MARINADE_MINT_OFFSET: usize = 8;
const MARINADE_PRICE_OFFSET: usize = 512;
const MARINADE_MIN_LEN: usize = MARINADE_PRICE_OFFSET + 8;
const SCTRL_TOTAL_SOL_VALUE_OFFSET: usize = 0;
const SCTRL_LP_MINT_OFFSET: usize = 144;
const SCTRL_MIN_LEN: usize = SCTRL_LP_MINT_OFFSET + 32;
const SPL_MINT_SUPPLY_OFFSET: usize = 36;
const SPL_MINT_MIN_LEN: usize = SPL_MINT_SUPPLY_OFFSET + 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reader {
    /// Account = the SPL stake-pool state.
    SplStakePool(&'static str),
    /// Account = the Marinade state.
    Marinade(&'static str),
    /// Account = S Controller PoolState; the LP mint account is read too.
    SController(&'static str),
}

#[derive(Debug, Clone, Copy)]
pub struct OnchainSpec {
    pub symbol: &'static str,
    pub mint: &'static str,
    pub reader: Reader,
}

impl OnchainSpec {
    /// Accounts to fetch, in the order `decode_onchain_nav` expects.
    pub fn accounts(&self) -> Result<Vec<Pubkey>> {
        let one = |s: &str| Pubkey::from_str(s).with_context(|| format!("{} account", self.symbol));
        Ok(match self.reader {
            Reader::SplStakePool(a) | Reader::Marinade(a) => vec![one(a)?],
            Reader::SController(a) => vec![one(a)?, one(self.mint)?],
        })
    }
}

/// One entry per `sanctum_lst` asset in `assets.toml`. Pool addresses come from
/// the sanctum-lst-list registry and were each confirmed on mainnet (owner is a
/// known stake-pool program and `pool_mint` equals the LST mint; the decoder
/// re-checks both at runtime).
pub static ONCHAIN_SPECS: &[OnchainSpec] = &[
    OnchainSpec {
        symbol: "bSOL",
        mint: "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1",
        reader: Reader::SplStakePool("stk9ApL5HeVAwPLr3TLhDXdZS8ptVu7zp6ov8HFDuMi"),
    },
    OnchainSpec {
        symbol: "bbSOL",
        mint: "Bybit2vBJGhPF52GBdNaQfUJ6ZpThSgHBobjWZpLPb4B",
        reader: Reader::SplStakePool("2aMLkB5p5gVvCwKkdSo5eZAL1WwhZbxezQr1wxiynRhq"),
    },
    OnchainSpec {
        symbol: "JupSOL",
        mint: "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v",
        reader: Reader::SplStakePool("8VpRhuxa7sUUepdY3kQiTmX9rS5vx4WgaXiAnXq4KCtr"),
    },
    OnchainSpec {
        symbol: "hyloSOL",
        mint: "hy1oXYgrBW6PVcJ4s6s2FKavRdwgWTXdfE69AxT7kPT",
        reader: Reader::SplStakePool("hy1oDeVCVRDGkxS26qLVDvRhDpZGfWJ6w9AMvwMegwL"),
    },
    OnchainSpec {
        symbol: "hyloSOL+",
        mint: "hy1opf2bqRDwAxoktyWAj6f3UpeHcLydzEdKjMYGs2u",
        reader: Reader::SplStakePool("hy1o2kiYu9rUDFqHJSqwJH4j5ZkM23tBJsaEmqkP9sT"),
    },
    OnchainSpec {
        symbol: "dzSOL",
        mint: "Gekfj7SL2fVpTDxJZmeC46cTYxinjB6gkAnb6EGT6mnn",
        reader: Reader::SplStakePool("3fV1sdGeXaNEZj6EPDTpub82pYxcRXwt2oie6jkSzeWi"),
    },
    OnchainSpec {
        symbol: "vSOL",
        mint: "vSoLxydx6akxyMD9XEcPvGYNGq6Nn66oqVb3UkGkei7",
        reader: Reader::SplStakePool("Fu9BYC6tWBo1KMKaP3CFoKfRhqv9akmy3DuYwnCyWiyC"),
    },
    OnchainSpec {
        symbol: "BNSOL",
        mint: "BNso1VUJnh4zcfpZa6986Ea66P6TCp59hvtNJ8b1X85",
        reader: Reader::SplStakePool("Hr9pzexrBge3vgmBNRR8u42CNQgBXdHm4UkUN2DH4a7r"),
    },
    OnchainSpec {
        symbol: "dynoSOL",
        mint: "DYNoyS3x5qgbccZg7RPXagm4xQzfnm5iwd9o8pMyJtdE",
        reader: Reader::SplStakePool("DpooSqZRL3qCmiq82YyB4zWmLfH3iEqx2gy8f2B6zjru"),
    },
    OnchainSpec {
        symbol: "PSOL",
        mint: "pSo1f9nQXWgXibFtKf7NWYxb5enAM4qfP6UJSiXRQfL",
        reader: Reader::SplStakePool("pSPcvR8GmG9aKDUbn9nbKYjkxt9hxMS7kF1qqKJaPqJ"),
    },
    OnchainSpec {
        symbol: "JSOL",
        mint: "7Q2afV64in6N6SeZsAAB81TJzwDoD6zpqmHkzi9Dcavn",
        reader: Reader::SplStakePool("CtMyWsrUtAwXWiGr9WjHT5fC3p3fgV8cyGpLTo2LJzG1"),
    },
    OnchainSpec {
        symbol: "hSOL",
        mint: "he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A",
        reader: Reader::SplStakePool("3wK2g8ZdzAH8FJ7PKr2RcvGh7V9VYson5hrVsJM5Lmws"),
    },
    OnchainSpec {
        symbol: "edgeSOL",
        mint: "edge86g9cVz87xcpKpy3J77vbp4wYd9idEV562CCntt",
        reader: Reader::SplStakePool("edgejNWAqkePLpi5sHRxT9vHi7u3kSHP9cocABPKiWZ"),
    },
    OnchainSpec {
        symbol: "jagSOL",
        mint: "jag58eRBC1c88LaAsRPspTMvoKJPbnzw9p9fREzHqyV",
        reader: Reader::SplStakePool("jagEdDepWUgexiu4jxojcRWcVKKwFqgZBBuAoGu2BxM"),
    },
    OnchainSpec {
        symbol: "definSOL",
        mint: "DEF1NXSZ8Th9n28hYBayrFtx9bj1EwwTiy3mhHEB9oyA",
        reader: Reader::SplStakePool("Bvbu55B991evqqhLtKcyTZjzQ4EQzRUwtf9T4CcpMmPL"),
    },
    OnchainSpec {
        symbol: "sharkSOL",
        mint: "BdMLRC2gKyFu8FRBErazzpEaKmB1jcVB9Eq1rXXFm4EV",
        reader: Reader::SplStakePool("HQLwnQJFH7t9nBTP4vbdW4eHy62aecfDnj8te8VzqkFL"),
    },
    OnchainSpec {
        symbol: "BulkSOL",
        mint: "BULKoNSGzxtCqzwTvg5hFJg8fx6dqZRScyXe5LYMfxrn",
        reader: Reader::SplStakePool("3aUmJDNpMHjkxunQEkHTj2chzyryKoH2uQj6YACLD174"),
    },
    OnchainSpec {
        symbol: "bonkSOL",
        mint: "BonK1YhkXEGLZzwtcvRTip3gAL9nCeQD7ppZBLXhtTs",
        reader: Reader::SplStakePool("ArAQfbzsdotoKB5jJcZa3ajQrrPcWr2YQoDAEAiFxJAC"),
    },
    OnchainSpec {
        symbol: "cgntSOL",
        mint: "CgnTSoL3DgY9SFHxcLj6CgCgKKoTBr6tp4CPAEWy25DE",
        reader: Reader::SplStakePool("CgntPoLka5pD5fesJYhGmUCF8KU1QS1ZmZiuAuMZr2az"),
    },
    OnchainSpec {
        symbol: "LST",
        mint: "LSTxxxnJzKDFSLr4dUkPcmCf5VyryEqzPLz5j4bpxFp",
        reader: Reader::SplStakePool("DqhH94PjkZsjAqEze2BEkWhFQJ6EyU6MdtMphMgnXqeK"),
    },
    OnchainSpec {
        symbol: "CDCSOL",
        mint: "CDCSoLckzozyktpAp9FWT3w92KFJVEUxAU7cNu2Jn3aX",
        reader: Reader::SplStakePool("8B9yuGU5SbXLE56k4yH2AfqbMXNEah7MJMbZKDPqg23X"),
    },
    OnchainSpec {
        symbol: "bpSOL",
        mint: "BPSoLzmLQn47EP5aa7jmFngRL8KC3TWAeAwXwZD8ip3P",
        reader: Reader::SplStakePool("ETVc1GBAiKzv2gNaA3Hfq4hsS1Mzh1NwQSxRFst7k8vz"),
    },
    OnchainSpec {
        symbol: "haSOL",
        mint: "haSo1Vz5aTsqEnz8nisfnEsipvbAAWpgzRDh2WhhMEh",
        reader: Reader::SplStakePool("9ovWYMZp18Qn7UVbyUvwqLSBBSEPDDA5q9pUgDFy6R23"),
    },
    OnchainSpec {
        symbol: "laineSOL",
        mint: "LAinEtNLgpmCP9Rvsf5Hn8W6EhNiKLZQti1xfWMLy6X",
        reader: Reader::SplStakePool("2qyEeSAWKfU18AFthrF7JA8z8ZCi1yt76Tqs917vwQTV"),
    },
    OnchainSpec {
        symbol: "xandSOL",
        mint: "XAnDeUmMcqFyCdef9jzpNgtZPjTj3xUMj9eXKn2reFN",
        reader: Reader::SplStakePool("xanDnetFGrZkp49s8brXbg6T215JeDTeSfDF19wBiNQ"),
    },
    OnchainSpec {
        symbol: "raiSOL",
        mint: "Ra1so1sTkvX3PorAM9ewqrsUMz9sPSbfFZ5oZUjN4oc",
        reader: Reader::SplStakePool("RaiDhwyRoMVxLN9KD7kAXAwHbWKf1TCTe5HFSrPVJaD"),
    },
    OnchainSpec {
        symbol: "picoSOL",
        mint: "picobAEvs6w7QEknPce34wAE4gknZA9v5tTonnmHYdX",
        reader: Reader::SplStakePool("8Dv3hNYcEWEaa4qVx9BTN1Wfvtha1z8cWDUXb7KVACVe"),
    },
    OnchainSpec {
        symbol: "mangoSOL",
        mint: "MangmsBgFqJhW4cLUR9LxfVgMboY1xAoP8UUBiWwwuY",
        reader: Reader::SplStakePool("9jWbABPXfc75wseAbLEkBCb1NRaX9EbJZJTDQnbtpzc1"),
    },
    OnchainSpec {
        symbol: "iASOL",
        mint: "HALALGvdNJ8u1J3uFFSsba1tyYPRF3vnYfCQ3CpJasfD",
        reader: Reader::SplStakePool("C5jSbkdn83TK2ajtsAdK7T1gzH2NugZk4VoNSem2qjzR"),
    },
    OnchainSpec {
        symbol: "lanternSOL",
        mint: "LnTRntk2kTfWEY6cVB8K9649pgJbt6dJLS1Ns1GZCWg",
        reader: Reader::SplStakePool("LW3qEdGWdVrxNgxSXW8vZri7Jifg4HuKEQ1UABLxs3C"),
    },
    OnchainSpec {
        symbol: "RoXSOL",
        mint: "roxDFxTFHufJBFy3PgzZcgz6kwkQNPZpi9RfpcAv4bu",
        reader: Reader::SplStakePool("BuMRVW5uUQqJmguCk4toGh7DB3CcJt6dk64JiUMdYS22"),
    },
    OnchainSpec {
        symbol: "proSOL",
        mint: "jucy5XJ76pHVvtPZb5TKRcGQExkwit2P5s4vY8UzmpC",
        reader: Reader::SplStakePool("AZGSr2fUyKkPLMhAW6WUEKEsQiRMAFKf8Fjnt4MFFaGv"),
    },
    OnchainSpec {
        symbol: "dumSOL",
        mint: "cPQPBN7WubB3zyQDpzTK2ormx1BMdAym9xkrYUJsctm",
        reader: Reader::SplStakePool("2iZHumJq19hyCYkD3xFoZ6dbiFbJ5nqbwALMdJBYQsJa"),
    },
    OnchainSpec {
        symbol: "sctmSOL",
        mint: "sctmAy9zFfZznZUWxEMgGtF6PHZ3gwoiCGcfwRua1AZ",
        reader: Reader::SplStakePool("E2fVGkhB4No2KJiXCfVqLUPjjiuyJwmPod8BtcHXkcZk"),
    },
    OnchainSpec {
        symbol: "xSHIN",
        mint: "xSoL18r4U1k2ALa4yF857VDZJqCKecLtty92nscre3o",
        reader: Reader::SplStakePool("spp1mo6shdcrRyqDK2zdurJ8H5uttZE6H6oVjHxN1QN"),
    },
    OnchainSpec {
        symbol: "aeroSOL",
        mint: "aeroXvCT6tjGVNyTvZy86tFDwE4sYsKCh7FbNDcrcxF",
        reader: Reader::SplStakePool("aero2ePURjuEgLKTzcUmF6RypBncBGd7pMUYCoSsVJ6"),
    },
    OnchainSpec {
        symbol: "dfdvSOL",
        mint: "sctmB7GPi5L2Q5G9tUSzXvhZ4YiDMEGcRov9KfArQpx",
        reader: Reader::SplStakePool("pyZMBjpWsVjKANAYK5mpNbKiws2krjRPZ2N2UYCSnbP"),
    },
    OnchainSpec {
        symbol: "GTSOL",
        mint: "gateMurAxe4YFoUR6J63gXGKtkbTfdkMdLjZrCmThFP",
        reader: Reader::SplStakePool("31Mwyr8Qof3LjB7Nn8fuWk6HcGVJCTYFYU3bAmW9fcL1"),
    },
    OnchainSpec {
        symbol: "dSOL",
        mint: "Dso1bDeDjCQxTrWHqUUi63oBvV7Mdm6WaobLbQ7gnPQ",
        reader: Reader::SplStakePool("9mhGNSPArRMHpLDMSmxAvuoizBqtBGqYdT8WGuqgxNdn"),
    },
    OnchainSpec {
        symbol: "mSOL",
        mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
        reader: Reader::Marinade(MARINADE_STATE),
    },
    OnchainSpec {
        symbol: "INF",
        mint: "5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm",
        reader: Reader::SController(S_CONTROLLER_POOL_STATE),
    },
];

pub fn spec_for_mint(mint: &str) -> Option<&'static OnchainSpec> {
    ONCHAIN_SPECS.iter().find(|s| s.mint == mint)
}

/// Decoded on-chain NAV (SOL per LST).
#[derive(Debug, Clone, PartialEq)]
pub struct OnchainNav {
    pub nav_sol: Decimal,
    /// SPL stake pools only: epoch of the last `UpdateStakePoolBalance` crank.
    pub last_update_epoch: Option<u64>,
}

/// Decode the NAV from the fetched accounts. `accounts` is `(owner, data)` per
/// pubkey from `OnchainSpec::accounts`, same order.
pub fn decode_onchain_nav(spec: &OnchainSpec, accounts: &[(Pubkey, &[u8])]) -> Result<OnchainNav> {
    let mint = Pubkey::from_str(spec.mint).with_context(|| format!("{} mint", spec.symbol))?;
    match spec.reader {
        Reader::SplStakePool(_) => {
            let (owner, data) = accounts.first().context("missing pool account")?;
            ensure!(
                SPL_STAKE_POOL_PROGRAMS
                    .iter()
                    .any(|p| Pubkey::from_str(p).ok().as_ref() == Some(owner)),
                "{} stake-pool owner {owner} is not a known stake-pool program",
                spec.symbol
            );
            let (nav_sol, _, _, epoch) = spl_stake_pool::decode_nav_sol(data, &mint)?;
            Ok(OnchainNav {
                nav_sol,
                last_update_epoch: Some(epoch),
            })
        }
        Reader::Marinade(_) => {
            let (owner, data) = accounts.first().context("missing marinade state")?;
            ensure!(
                owner.to_string() == MARINADE_PROGRAM,
                "marinade state owner {owner} mismatch"
            );
            Ok(OnchainNav {
                nav_sol: decode_marinade_nav(data, &mint)?,
                last_update_epoch: None,
            })
        }
        Reader::SController(_) => {
            let (owner, pool) = accounts.first().context("missing s-controller pool")?;
            let (_, mint_acct) = accounts.get(1).context("missing INF mint account")?;
            ensure!(
                owner.to_string() == S_CONTROLLER_PROGRAM,
                "s-controller pool owner {owner} mismatch"
            );
            Ok(OnchainNav {
                nav_sol: decode_scontroller_nav(pool, mint_acct, &mint)?,
                last_update_epoch: None,
            })
        }
    }
}

/// Sanity band shared with `spl_stake_pool::decode_nav_sol`.
fn check_band(nav: Decimal, what: &str) -> Result<Decimal> {
    ensure!(
        nav >= Decimal::from_str("0.99").unwrap() && nav < Decimal::from(2u32),
        "{what} NAV {nav} outside [0.99, 2.0) — layout drift or unhealthy pool"
    );
    Ok(nav)
}

fn u64_at(data: &[u8], off: usize) -> Result<u64> {
    let b = data
        .get(off..off.checked_add(8).context("offset overflow")?)
        .context("u64 read out of bounds")?;
    Ok(u64::from_le_bytes(b.try_into().unwrap()))
}

/// Marinade mSOL: `msol_price` is a u64 with a 32-bit fractional part.
pub fn decode_marinade_nav(data: &[u8], expected_mint: &Pubkey) -> Result<Decimal> {
    ensure!(data.len() >= MARINADE_MIN_LEN, "marinade state too short");
    ensure!(
        data[..8] == MARINADE_STATE_DISC,
        "not a Marinade State account"
    );
    let m = Pubkey::try_from(&data[MARINADE_MINT_OFFSET..MARINADE_MINT_OFFSET + 32])
        .map_err(|_| anyhow::anyhow!("bad msol_mint"))?;
    ensure!(
        &m == expected_mint,
        "msol_mint mismatch: {m} vs {expected_mint}"
    );
    let price = u64_at(data, MARINADE_PRICE_OFFSET)?;
    let nav = Decimal::from(price)
        .checked_div(Decimal::from(1u64 << 32))
        .context("marinade price division")?;
    check_band(nav, "mSOL")
}

/// Sanctum Infinity: `total_sol_value / INF supply`.
pub fn decode_scontroller_nav(
    pool: &[u8],
    lp_mint_acct: &[u8],
    expected_mint: &Pubkey,
) -> Result<Decimal> {
    ensure!(pool.len() >= SCTRL_MIN_LEN, "s-controller pool too short");
    let m = Pubkey::try_from(&pool[SCTRL_LP_MINT_OFFSET..SCTRL_LP_MINT_OFFSET + 32])
        .map_err(|_| anyhow::anyhow!("bad lp_token_mint"))?;
    ensure!(
        &m == expected_mint,
        "lp_token_mint mismatch: {m} vs {expected_mint}"
    );
    ensure!(
        lp_mint_acct.len() >= SPL_MINT_MIN_LEN,
        "INF mint account too short"
    );
    let total_sol_value = u64_at(pool, SCTRL_TOTAL_SOL_VALUE_OFFSET)?;
    let supply = u64_at(lp_mint_acct, SPL_MINT_SUPPLY_OFFSET)?;
    ensure!(
        total_sol_value > 0 && supply > 0,
        "INF zero total_sol_value/supply"
    );
    let nav = Decimal::from(total_sol_value)
        .checked_div(Decimal::from(supply))
        .context("INF NAV division")?;
    check_band(nav, "INF")
}

/// Outcome of the NAV selection for one LST.
#[derive(Debug, Clone, PartialEq)]
pub enum NavDecision {
    /// Publish the on-chain NAV. `api_drift_bps` = (api − onchain)/onchain in bps
    /// when an API value existed.
    Onchain {
        nav: Decimal,
        api_drift_bps: Option<i64>,
        api_drifted: bool,
    },
    /// No on-chain read; API value passed (or no market reference to check it).
    Api { checked_against_market: bool },
    /// No on-chain read and the API value sits more than the bound below the
    /// market-implied NAV: withhold it, flag the intrinsic stale.
    Degraded { shortfall_bps: i64 },
    /// No on-chain read, no market reference: the API value cannot be verified
    /// (only returned for assets that require a reference). Withhold + flag.
    Unverified,
    /// Nothing usable (no API value, no on-chain read).
    Nothing,
}

fn bps_of(num: Decimal, den: Decimal) -> Option<i64> {
    use rust_decimal::prelude::ToPrimitive;
    num.checked_div(den)?
        .checked_mul(Decimal::from(10_000u32))?
        .round()
        .to_i64()
}

/// Pick which NAV to publish. Pure — see the module docs for the policy.
///
/// The market check is deliberately ONE-SIDED (API below market): a genuine
/// depeg drives the market BELOW a correct NAV and must stay visible, whereas the
/// 2026-10-19 failure had the API NAV frozen LOW. Bounding only that side means
/// the guard can never hide a real depeg.
pub fn decide(
    api_nav: Option<Decimal>,
    onchain_nav: Option<Decimal>,
    market_nav: Option<Decimal>,
    max_drift_bps: i64,
    require_reference: bool,
) -> NavDecision {
    if let Some(on) = onchain_nav {
        let api_drift_bps = api_nav.and_then(|a| bps_of(a - on, on));
        return NavDecision::Onchain {
            nav: on,
            api_drift_bps,
            api_drifted: api_drift_bps.is_some_and(|d| d.abs() > max_drift_bps),
        };
    }
    let Some(api) = api_nav else {
        return NavDecision::Nothing;
    };
    match market_nav {
        Some(m) if m > Decimal::ZERO => {
            let shortfall = bps_of(m - api, m).unwrap_or(0);
            if shortfall > max_drift_bps {
                NavDecision::Degraded {
                    shortfall_bps: shortfall,
                }
            } else {
                NavDecision::Api {
                    checked_against_market: true,
                }
            }
        }
        _ if require_reference => NavDecision::Unverified,
        _ => NavDecision::Api {
            checked_against_market: false,
        },
    }
}

/// Resolve the result of the market-reference query. A DB error is NOT silently
/// an empty map: it is counted and logged, and the second value tells the caller
/// the reference is unavailable (so the fail-closed `Unverified` path applies).
pub fn market_ref_or_empty<E: std::fmt::Display>(
    res: std::result::Result<std::collections::HashMap<String, Decimal>, E>,
) -> (std::collections::HashMap<String, Decimal>, bool) {
    match res {
        Ok(m) => (m, false),
        Err(e) => {
            tracing::warn!(error = %e, "market reference query failed — unverifiable API NAVs will be withheld");
            metrics::counter!("pegana_sanctum_market_ref_errors_total").increment(1);
            (std::collections::HashMap::new(), true)
        }
    }
}

/// Whether a periodic liveness refresh is due: immediately on a change of the
/// stale verdict, otherwise every `refresh_secs` (the engine freshness-guards
/// the row, default 3600 s, so it must be re-stamped well inside that).
pub fn liveness_refresh_due(
    last: Option<(bool, std::time::Instant)>,
    stale_now: bool,
    now: std::time::Instant,
    refresh_secs: u64,
) -> bool {
    match last {
        None => true,
        Some((was, at)) => was != stale_now || now.duration_since(at).as_secs() >= refresh_secs,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> Decimal {
        Decimal::from_str(s).unwrap()
    }

    // --- decide() ---------------------------------------------------------

    #[test]
    fn onchain_always_wins_and_small_api_drift_is_not_flagged() {
        // API 0.5% below on-chain: within the 1% bound -> not flagged, but the
        // on-chain value is still the one published (no source flapping).
        let r = decide(Some(d("1.3011")), Some(d("1.3077")), None, 100, false);
        match r {
            NavDecision::Onchain {
                nav,
                api_drift_bps,
                api_drifted,
            } => {
                assert_eq!(nav, d("1.3077"));
                assert_eq!(api_drift_bps, Some(-50));
                assert!(!api_drifted);
            }
            o => panic!("unexpected {o:?}"),
        }
    }

    #[test]
    fn onchain_fallback_flags_api_beyond_threshold() {
        // The live jitoSOL numbers: API 1.275866 vs on-chain 1.3077 (-2.43%).
        let r = decide(
            Some(d("1.275866")),
            Some(d("1.3077")),
            Some(d("1.3057")),
            100,
            false,
        );
        match r {
            NavDecision::Onchain {
                nav,
                api_drift_bps,
                api_drifted,
            } => {
                assert_eq!(nav, d("1.3077"));
                assert_eq!(api_drift_bps, Some(-243));
                assert!(api_drifted);
            }
            o => panic!("unexpected {o:?}"),
        }
        // Exactly at the bound is NOT beyond it.
        match decide(Some(d("1.2946")), Some(d("1.3077")), None, 100, false) {
            NavDecision::Onchain {
                api_drift_bps,
                api_drifted,
                ..
            } => {
                assert_eq!(api_drift_bps, Some(-100));
                assert!(!api_drifted);
            }
            o => panic!("unexpected {o:?}"),
        }
    }

    #[test]
    fn onchain_published_even_when_api_missing() {
        match decide(None, Some(d("1.05749")), None, 100, false) {
            NavDecision::Onchain {
                nav,
                api_drift_bps,
                api_drifted,
            } => {
                assert_eq!(nav, d("1.05749"));
                assert_eq!(api_drift_bps, None);
                assert!(!api_drifted);
            }
            o => panic!("unexpected {o:?}"),
        }
    }

    #[test]
    fn no_onchain_api_within_market_band_is_ok() {
        // JupSOL-like: API 1.2166 vs market 1.2166 -> fine.
        assert_eq!(
            decide(Some(d("1.2150")), None, Some(d("1.2166")), 100, false),
            NavDecision::Api {
                checked_against_market: true
            }
        );
    }

    #[test]
    fn no_onchain_api_far_below_market_is_degraded() {
        // The 2026-10-19 signature: API 1.18394 vs market 1.2166 (-2.68%).
        match decide(Some(d("1.18394")), None, Some(d("1.2166")), 100, false) {
            NavDecision::Degraded { shortfall_bps } => assert_eq!(shortfall_bps, 268),
            o => panic!("unexpected {o:?}"),
        }
    }

    #[test]
    fn real_depeg_is_not_mistaken_for_stale_nav() {
        // Market 5% BELOW a correct API NAV is a genuine depeg: must NOT be
        // withheld (that would hide the very event the oracle exists to report).
        assert_eq!(
            decide(Some(d("1.20")), None, Some(d("1.14")), 100, false),
            NavDecision::Api {
                checked_against_market: true
            }
        );
    }

    #[test]
    fn no_reference_fails_open_but_says_so() {
        assert_eq!(
            decide(Some(d("1.2")), None, None, 100, false),
            NavDecision::Api {
                checked_against_market: false
            }
        );
        assert_eq!(
            decide(None, None, Some(d("1.2")), 100, false),
            NavDecision::Nothing
        );
    }

    #[test]
    fn onchain_failed_and_no_market_is_withheld_when_reference_required() {
        assert_eq!(
            decide(Some(d("1.2")), None, None, 100, true),
            NavDecision::Unverified
        );
        // Inactive assets (reference not required) keep the old fail-open.
        assert_eq!(
            decide(Some(d("1.2")), None, None, 100, false),
            NavDecision::Api {
                checked_against_market: false
            }
        );
        // A market reference rescues it; an on-chain read always wins.
        assert_eq!(
            decide(Some(d("1.2")), None, Some(d("1.2")), 100, true),
            NavDecision::Api {
                checked_against_market: true
            }
        );
        assert!(matches!(
            decide(Some(d("1.2")), Some(d("1.2")), None, 100, true),
            NavDecision::Onchain { .. }
        ));
    }

    #[test]
    fn market_query_error_is_not_swallowed_into_a_silent_reference() {
        let mut ok = std::collections::HashMap::new();
        ok.insert("X".to_string(), d("1.0"));
        let (m, errored) = market_ref_or_empty::<String>(Ok(ok));
        assert!(!errored && m.len() == 1);
        let (m, errored) = market_ref_or_empty(Err("db down".to_string()));
        assert!(errored && m.is_empty());
        // ...and the empty map from an error leads to withholding, not publishing.
        let market_nav = m.get("X").copied();
        assert_eq!(
            decide(Some(d("1.2")), None, market_nav, 100, true),
            NavDecision::Unverified
        );
    }

    #[test]
    fn liveness_refresh_fires_on_change_or_after_interval() {
        let t0 = std::time::Instant::now();
        let later = t0 + std::time::Duration::from_secs(301);
        assert!(liveness_refresh_due(None, false, t0, 300));
        assert!(!liveness_refresh_due(Some((false, t0)), false, t0, 300));
        assert!(liveness_refresh_due(Some((false, t0)), true, t0, 300));
        assert!(liveness_refresh_due(Some((true, t0)), true, later, 300));
    }

    // --- decoders ---------------------------------------------------------

    fn pk(s: &str) -> Pubkey {
        Pubkey::from_str(s).unwrap()
    }

    fn marinade_blob(mint: &Pubkey, price: u64) -> Vec<u8> {
        let mut v = vec![0u8; 2616];
        v[..8].copy_from_slice(&MARINADE_STATE_DISC);
        v[8..40].copy_from_slice(mint.as_ref());
        v[MARINADE_PRICE_OFFSET..MARINADE_PRICE_OFFSET + 8].copy_from_slice(&price.to_le_bytes());
        v
    }

    #[test]
    fn marinade_price_is_32bit_fixed_point() {
        let mint = pk("mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So");
        // 1.4130461… as read live on 2026-10-20.
        let nav = decode_marinade_nav(&marinade_blob(&mint, 6_068_986_825), &mint).unwrap();
        assert_eq!(nav, d("6068986825") / d("4294967296"));
        assert!(nav > d("1.41") && nav < d("1.42"), "{nav}");
        assert!(decode_marinade_nav(&marinade_blob(&mint, 4_294_967_296 * 5), &mint).is_err());
        let other = pk("bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1");
        assert!(decode_marinade_nav(&marinade_blob(&mint, 6_068_986_825), &other).is_err());
        let mut bad = marinade_blob(&mint, 6_068_986_825);
        bad[0] ^= 1;
        assert!(decode_marinade_nav(&bad, &mint).is_err());
    }

    #[test]
    fn scontroller_nav_is_total_sol_value_over_lp_supply() {
        let inf = pk("5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm");
        let mut pool = vec![0u8; 240];
        pool[..8].copy_from_slice(&1_924_508_945_932_894u64.to_le_bytes());
        pool[144..176].copy_from_slice(inf.as_ref());
        let mut mint_acct = vec![0u8; 82];
        mint_acct[36..44].copy_from_slice(&1_320_077_301_780_047u64.to_le_bytes());
        let nav = decode_scontroller_nav(&pool, &mint_acct, &inf).unwrap();
        assert!(nav > d("1.4578") && nav < d("1.4579"), "{nav}");
        let other = pk("mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So");
        assert!(decode_scontroller_nav(&pool, &mint_acct, &other).is_err());
        mint_acct[36..44].copy_from_slice(&0u64.to_le_bytes());
        assert!(decode_scontroller_nav(&pool, &mint_acct, &inf).is_err());
    }

    fn spl_blob(mint: &Pubkey, total: u64, supply: u64) -> Vec<u8> {
        let mut v = vec![0u8; 611];
        v[0] = 1;
        v[162..194].copy_from_slice(mint.as_ref());
        v[258..266].copy_from_slice(&total.to_le_bytes());
        v[266..274].copy_from_slice(&supply.to_le_bytes());
        v[274..282].copy_from_slice(&1062u64.to_le_bytes());
        v
    }

    #[test]
    fn spl_pool_nav_maps_through_spec_and_checks_owner() {
        let spec = spec_for_mint("jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v").unwrap();
        assert_eq!(spec.symbol, "JupSOL");
        let mint = pk(spec.mint);
        let data = spl_blob(&mint, 12_152_470_000, 10_000_000_000);
        let multi = pk("SPMBzsVUuoHA4Jm6KunbsotaahvVikZs1JyTW6iJvbn");
        let got = decode_onchain_nav(spec, &[(multi, &data)]).unwrap();
        assert_eq!(got.nav_sol, d("1.215247"));
        assert_eq!(got.last_update_epoch, Some(1062));
        // A look-alike account owned by an arbitrary program is refused.
        let evil = pk("11111111111111111111111111111111");
        assert!(decode_onchain_nav(spec, &[(evil, &data)]).is_err());
        // Wrong mint inside the pool is refused.
        let wrong = spl_blob(&pk("bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1"), 12, 10);
        assert!(decode_onchain_nav(spec, &[(multi, &wrong)]).is_err());
    }

    #[test]
    fn frozen_pool_crank_is_flagged_stale_via_the_shared_epoch_lag_rule() {
        use crate::sources::spl_stake_pool::{epoch_lag, EPOCH_LAG_WARN};
        // sharkSOL live: last_update_epoch 1002 vs current 1062.
        let spec = spec_for_mint("BdMLRC2gKyFu8FRBErazzpEaKmB1jcVB9Eq1rXXFm4EV").unwrap();
        let mut data = spl_blob(&pk(spec.mint), 10_574_900_000, 10_000_000_000);
        data[274..282].copy_from_slice(&1002u64.to_le_bytes());
        let spl = pk(SPL_STAKE_POOL_PROGRAMS[0]);
        let nav = decode_onchain_nav(spec, &[(spl, &data)]).unwrap();
        let last = nav.last_update_epoch.expect("epoch captured");
        assert_eq!(last, 1002);
        assert!(epoch_lag(1062, last) >= EPOCH_LAG_WARN);
        // A pool cranked this epoch (or the previous one) is healthy.
        assert!(epoch_lag(1062, 1062) < EPOCH_LAG_WARN);
        assert!(epoch_lag(1062, 1061) < EPOCH_LAG_WARN);
    }

    // --- table integrity --------------------------------------------------

    #[test]
    fn every_spec_account_is_a_valid_pubkey_and_mints_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for s in ONCHAIN_SPECS {
            assert!(seen.insert(s.mint), "duplicate mint {}", s.symbol);
            Pubkey::from_str(s.mint).unwrap();
            assert!(!s.accounts().unwrap().is_empty(), "{}", s.symbol);
        }
    }

    #[test]
    fn every_sanctum_lst_in_assets_toml_has_an_onchain_spec() {
        // Non-vacuous coverage lock: a new `sanctum_lst` asset without a mapping
        // would silently fall back to guard-only; fail CI instead so it is added.
        let raw = std::fs::read_to_string("../../assets.toml").expect("assets.toml");
        let v: toml::Value = toml::from_str(&raw).unwrap();
        let mut checked = 0;
        for a in v["assets"].as_array().unwrap() {
            if a["intrinsic"]["kind"].as_str() != Some("sanctum_lst") {
                continue;
            }
            let (sym, mint) = (a["symbol"].as_str().unwrap(), a["mint"].as_str().unwrap());
            let spec = spec_for_mint(mint)
                .unwrap_or_else(|| panic!("sanctum_lst {sym} ({mint}) has no ONCHAIN_SPECS entry"));
            assert_eq!(spec.symbol, sym);
            checked += 1;
        }
        assert!(checked >= 40, "only {checked} sanctum_lst assets seen");
    }

    /// LIVE check (network): `cargo test -p indexer-rs live_onchain_vs_api -- --ignored --nocapture`
    /// with `SOLANA_RPC_URL` set. Compares the new on-chain NAV against the
    /// currently served `api.pegana.xyz/v1/assets` row (discount = 1 - market/NAV).
    #[tokio::test]
    #[ignore]
    async fn live_onchain_vs_api() {
        use solana_rpc_client::nonblocking::rpc_client::RpcClient;
        let url = std::env::var("SOLANA_RPC_URL")
            .unwrap_or_else(|_| "https://api.mainnet-beta.solana.com".into());
        let rpc = RpcClient::new(url);
        let assets: serde_json::Value = reqwest::get("https://api.pegana.xyz/v1/assets")
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let rows = assets["data"].as_array().unwrap();
        let mut after_abs = Vec::new();
        for spec in ONCHAIN_SPECS {
            let keys = spec.accounts().unwrap();
            let accts = rpc.get_multiple_accounts(&keys).await.unwrap();
            let owned: Vec<(Pubkey, Vec<u8>)> = accts
                .into_iter()
                .map(|a| {
                    let a = a.expect("account exists");
                    (a.owner, a.data)
                })
                .collect();
            let refs: Vec<(Pubkey, &[u8])> =
                owned.iter().map(|(o, d)| (*o, d.as_slice())).collect();
            let nav = decode_onchain_nav(spec, &refs).unwrap().nav_sol;
            let Some(row) = rows.iter().find(|r| r["symbol"] == spec.symbol) else {
                continue;
            };
            let f = |k: &str| Decimal::from_str(row[k].as_str().unwrap_or("0")).unwrap();
            let (api_nav, intr_usd, mkt_usd) =
                (f("sol_per_lst"), f("intrinsic_usd"), f("market_usd"));
            if api_nav.is_zero() || intr_usd.is_zero() {
                continue;
            }
            let sol_usd = intr_usd / api_nav;
            let market_sol = mkt_usd / sol_usd;
            let before = row["discount"].as_str().unwrap_or("?");
            let after = Decimal::ONE - market_sol / nav;
            println!(
                "{:<9} api_nav={:.6} onchain_nav={:.6} market_nav={:.6} discount_before={} discount_after={:.5}",
                spec.symbol, api_nav, nav, market_sol, before, after
            );
            after_abs.push(after.abs());
        }
        assert!(
            after_abs.len() >= 35,
            "too few rows compared: {}",
            after_abs.len()
        );
        after_abs.sort();
        let median = after_abs[after_abs.len() / 2];
        println!(
            "median |discount_after| = {median:.5} over {} LSTs",
            after_abs.len()
        );
        assert!(
            median < d("0.005"),
            "on-chain NAV should sit within 0.5% of market"
        );
    }
}
