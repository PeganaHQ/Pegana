//! Black-box tests for the `GET /v1/audit` filters `asset`, `since`, `until`
//! and the keyset cursor `before` / `before_id`. Same harness and env gating
//! as `audit_ledger_gate.rs` (skips silently without
//! PEGANA_INTEGRATION_API_BASE + PEGANA_INTEGRATION_PG_URL).
//!
//! Seeds rows in an isolated 2001 time window so assertions are independent of
//! whatever else is in the ledger. Honors the ADR-0020 gate: when
//! FEATURE_PUBLIC_ALERTS is not true the index is empty regardless of filters.

use chrono::{DateTime, Duration, TimeZone, Utc};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

fn base() -> Option<String> {
    std::env::var("PEGANA_INTEGRATION_API_BASE")
        .ok()
        .filter(|s| !s.is_empty())
}
fn pg_url() -> Option<String> {
    std::env::var("PEGANA_INTEGRATION_PG_URL")
        .ok()
        .filter(|s| !s.is_empty())
}
fn public_alerts() -> bool {
    matches!(
        std::env::var("FEATURE_PUBLIC_ALERTS")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "true" | "1"
    )
}
fn enc(s: &str) -> String {
    s.replace('+', "%2B").replace(':', "%3A")
}
fn iso(t: DateTime<Utc>) -> String {
    enc(&t.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

async fn seed(pool: &PgPool, id: Uuid, asset: &str, class: &str, at: DateTime<Utc>) {
    sqlx::query(
        r#"INSERT INTO alerts (id, asset, class, from_state, to_state, discount,
                               intrinsic_usd, market_usd, confidence, detected_at, payload)
           VALUES ($1, $2, $3::asset_class, 'PEGGED'::peg_state, 'DRIFT'::peg_state,
                   0.001, 1.00, 0.999, 'high', $4, '{}'::jsonb)"#,
    )
    .bind(id)
    .bind(asset)
    .bind(class)
    .bind(at)
    .execute(pool)
    .await
    .expect("seed alert");
    sqlx::query(
        r#"INSERT INTO alert_evidence
               (alert_id, methodology_version, assets_toml_sha256,
                inputs_frozen, computed, replay_artifact, receipt_sha256,
                commit_status, onchain_tx_sig)
           VALUES ($1, '0.1.0', repeat('a', 64),
                   '{"asset":"USDC"}'::jsonb, '{"final_state":"DRIFT"}'::jsonb,
                   NULL, repeat('b', 64), 'not_applicable', NULL)"#,
    )
    .bind(id)
    .execute(pool)
    .await
    .expect("seed evidence");
}

async fn get(base: &str, qs: &str) -> (u16, Value) {
    let resp = reqwest::Client::new()
        .get(format!("{base}/v1/audit?{qs}"))
        .send()
        .await
        .expect("send");
    let status = resp.status().as_u16();
    (status, resp.json().await.unwrap_or(Value::Null))
}

fn ids(v: &Value) -> Vec<String> {
    v.as_array()
        .expect("array")
        .iter()
        .map(|r| r["id"].as_str().unwrap().to_string())
        .collect()
}

/// Seeds 5 USDC rows (two sharing one millisecond) + 1 USDT row inside a 2001
/// window. Returns (window_start, window_end, ids newest-first for USDC).
async fn fixture(pool: &PgPool) -> (DateTime<Utc>, DateTime<Utc>, Vec<Uuid>, Uuid) {
    let t0 = Utc.with_ymd_and_hms(2001, 3, 1, 0, 0, 0).unwrap() + Duration::seconds(rand_secs());
    let mut usdc = Vec::new();
    for i in 0..4 {
        let id = Uuid::new_v4();
        seed(pool, id, "USDC", "stable_fiat", t0 + Duration::minutes(i)).await;
        usdc.push((t0 + Duration::minutes(i), id));
    }
    // Tie: same detected_at as the newest row, different id.
    let tie = Uuid::new_v4();
    seed(pool, tie, "USDC", "stable_fiat", t0 + Duration::minutes(3)).await;
    usdc.push((t0 + Duration::minutes(3), tie));
    let other = Uuid::new_v4();
    seed(
        pool,
        other,
        "USDT",
        "stable_fiat",
        t0 + Duration::minutes(2),
    )
    .await;
    // Newest first: (time DESC, id DESC).
    usdc.sort_by(|a, b| b.cmp(a));
    (
        t0 - Duration::seconds(1),
        t0 + Duration::minutes(10),
        usdc.into_iter().map(|(_, id)| id).collect(),
        other,
    )
}

fn rand_secs() -> i64 {
    // Spread runs over ~11 days so repeated runs never collide on windows.
    (Uuid::new_v4().as_u128() % 1_000_000) as i64
}

#[tokio::test]
async fn asset_since_until_and_gate() {
    let (Some(base), Some(pg)) = (base(), pg_url()) else {
        return;
    };
    let pool = PgPool::connect(&pg).await.unwrap();
    let (lo, hi, usdc, other) = fixture(&pool).await;
    let win = format!("since={}&until={}&limit=100", iso(lo), iso(hi));

    let (st, all) = get(&base, &win).await;
    assert_eq!(st, 200);
    if !public_alerts() {
        assert!(ids(&all).is_empty(), "gate: index must be empty");
        let (_, f) = get(&base, &format!("{win}&asset=USDC")).await;
        assert!(ids(&f).is_empty(), "gate: filters must not bypass it");
        return;
    }
    assert!(ids(&all).contains(&other.to_string()));
    assert_eq!(ids(&all).len(), 6);

    let (_, f) = get(&base, &format!("{win}&asset=USDC")).await;
    let got = ids(&f);
    assert_eq!(got.len(), 5);
    assert!(!got.contains(&other.to_string()));
    assert_eq!(got, usdc.iter().map(|u| u.to_string()).collect::<Vec<_>>());

    // Exact match: case-sensitive.
    let (_, f) = get(&base, &format!("{win}&asset=usdc")).await;
    assert!(ids(&f).is_empty());

    // until is exclusive: a window ending at the newest row's time drops it.
    let t_newest = lo + Duration::seconds(1) + Duration::minutes(3);
    let (_, f) = get(
        &base,
        &format!("since={}&until={}&asset=USDC", iso(lo), iso(t_newest)),
    )
    .await;
    assert_eq!(ids(&f).len(), 3);
    // since is inclusive.
    let (_, f) = get(
        &base,
        &format!("since={}&until={}&asset=USDC", iso(t_newest), iso(hi)),
    )
    .await;
    assert_eq!(ids(&f).len(), 2);
}

#[tokio::test]
async fn cursor_paging_walks_every_row_once_including_ties() {
    let (Some(base), Some(pg)) = (base(), pg_url()) else {
        return;
    };
    if !public_alerts() {
        return;
    }
    let pool = PgPool::connect(&pg).await.unwrap();
    let (lo, hi, usdc, _) = fixture(&pool).await;
    let win = format!("since={}&until={}&asset=USDC&limit=2", iso(lo), iso(hi));

    let mut seen: Vec<String> = Vec::new();
    let mut qs = win.clone();
    for _ in 0..10 {
        let (st, page) = get(&base, &qs).await;
        assert_eq!(st, 200);
        let rows = page.as_array().unwrap();
        if rows.is_empty() {
            break;
        }
        assert!(rows.len() <= 2);
        let last = rows.last().unwrap();
        seen.extend(ids(&page));
        qs = format!(
            "{win}&before={}&before_id={}",
            enc(last["detected_at"].as_str().unwrap()),
            last["id"].as_str().unwrap()
        );
    }
    assert_eq!(
        seen,
        usdc.iter().map(|u| u.to_string()).collect::<Vec<_>>(),
        "paging must return each row exactly once, newest first"
    );
}

#[tokio::test]
async fn invalid_inputs_are_400() {
    let Some(base) = base() else { return };
    for (qs, code) in [
        ("asset=bad%20sym", Some("invalid_asset")),
        ("asset=x%27%3B--", Some("invalid_asset")),
        (
            "since=2026-02-01T00:00:00Z&until=2026-01-01T00:00:00Z",
            Some("invalid_range"),
        ),
        (
            "before_id=00000000-0000-0000-0000-000000000000",
            Some("invalid_cursor"),
        ),
        ("since=yesterday", None),
        ("before=nope", None),
        ("before_id=nope&before=2026-01-01T00:00:00Z", None),
    ] {
        let (st, body) = get(&base, qs).await;
        assert_eq!(st, 400, "{qs}");
        if let Some(c) = code {
            assert_eq!(body["error"], c, "{qs}");
        }
    }
}

/// Round-3 F3: xSOL (synth_lev) receipts are excluded from the discoverable
/// ledger (index, `?asset=`, CSV) like every `/v1/assets*` route excludes
/// the asset, while the receipt itself stays reachable by id. Skips when the
/// database has no `xSOL` catalog row of class `synth_lev` to attach to.
#[tokio::test]
async fn non_public_asset_is_hidden_from_the_ledger_but_resolves_by_id() {
    let (Some(base), Some(pg)) = (base(), pg_url()) else {
        return;
    };
    let pool = PgPool::connect(&pg).await.unwrap();
    let class: Option<(String,)> =
        sqlx::query_as("SELECT class::text FROM assets WHERE symbol = 'xSOL'")
            .fetch_optional(&pool)
            .await
            .unwrap();
    if class.map(|c| c.0) != Some("synth_lev".to_string()) {
        return;
    }
    let t0 = Utc.with_ymd_and_hms(2001, 6, 1, 0, 0, 0).unwrap() + Duration::seconds(rand_secs());
    let xsol = Uuid::new_v4();
    seed(&pool, xsol, "xSOL", "synth_lev", t0).await;
    let usdc = Uuid::new_v4();
    seed(
        &pool,
        usdc,
        "USDC",
        "stable_fiat",
        t0 + Duration::seconds(1),
    )
    .await;
    let (lo, hi) = (t0 - Duration::seconds(1), t0 + Duration::minutes(1));
    let win = format!("since={}&until={}&limit=100", iso(lo), iso(hi));

    // `?asset=xSOL` is a 404 unknown_asset on the index, gate or no gate.
    let (st, body) = get(&base, &format!("{win}&asset=xSOL")).await;
    assert_eq!(st, 404, "{body}");
    assert_eq!(body["error"], "unknown_asset");

    // CSV: same 404 for the filter.
    let client = reqwest::Client::new();
    let csv_url =
        |extra: &str| format!("{base}/v1/audit.csv?from={}&to={}{extra}", iso(lo), iso(hi));
    let resp = client.get(csv_url("&asset=xSOL")).send().await.unwrap();
    assert_eq!(resp.status().as_u16(), 404);

    if public_alerts() {
        // The window lists the public row only.
        let (st, all) = get(&base, &win).await;
        assert_eq!(st, 200);
        let got = ids(&all);
        assert!(got.contains(&usdc.to_string()));
        assert!(!got.contains(&xsol.to_string()), "xSOL must not be indexed");
        let text = client
            .get(csv_url(""))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert!(text.contains(&usdc.to_string()));
        assert!(
            !text.contains(&xsol.to_string()),
            "xSOL must not be exported"
        );
    }

    // The receipt itself stays reachable by id: permanent public evidence.
    let resp = client
        .get(format!("{base}/v1/audit/{xsol}"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status().as_u16(), 200);
}
