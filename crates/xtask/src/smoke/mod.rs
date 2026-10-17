//! `cargo xtask smoke` — black-box canary against a running Pegana API.
//!
//! Adapted from `scripts/smoke-canary.ts` in solana-foundation/tokens (MIT).
//! Two ideas are lifted from it that the previous six-line curl loop in
//! `scripts/deploy.sh` did not have:
//!
//! 1. **A latency budget per probe.** A 200 that takes 40 seconds is a failed
//!    deploy, not a passing one. The old loop only compared the status code, so
//!    the 2026-07-25 incident class (an endpoint degrading from 38ms to 106s
//!    while still returning 200) would have shipped green.
//! 2. **Structural assertions, not just status codes.** Every `/v1` list route
//!    must satisfy the ADR-0043 envelope (`{ok, generated_at, count, data[]}`).
//!    Asserting the shape catches a contract regression that a status check
//!    cannot see.
//!
//! Deliberately NOT a GitHub Action: it must gate `scripts/deploy.sh` (and be
//! runnable by hand against `docker-compose.local.yml` on `:8081`) regardless
//! of CI availability.
//!
//! Exit code is non-zero if ANY probe fails → safe as a deploy gate.

use anyhow::{bail, Result};
use serde::Serialize;
use serde_json::Value;
use std::time::{Duration, Instant};

/// What a probe checks beyond "HTTP 200 within budget".
#[derive(Clone, Copy)]
enum Shape {
    /// No body assertion (health endpoints return an unspecified small body).
    Any,
    /// ADR-0043 list envelope: `{ok: true, generated_at, count, data: []}`,
    /// with `count == data.len()`.
    ApiList,
    /// `/v1/peg/feed`: the list envelope plus a `methodology` string, and every
    /// element must carry the `mint` join key partners index by.
    PegFeed,
    /// A bare JSON object (single-resource routes are unwrapped by ADR-0043).
    JsonObject,
}

struct Probe {
    name: &'static str,
    path: &'static str,
    /// Wall-clock budget. Exceeding it fails the probe even on a 200.
    budget: Duration,
    shape: Shape,
    /// A probe whose absence is not a deploy failure (feature-flagged surface).
    tolerate_404: bool,
}

fn probes() -> Vec<Probe> {
    vec![
        Probe {
            name: "healthz",
            path: "/healthz",
            budget: Duration::from_millis(2_000),
            shape: Shape::Any,
            tolerate_404: false,
        },
        Probe {
            name: "readyz",
            path: "/readyz",
            budget: Duration::from_millis(3_000),
            shape: Shape::Any,
            tolerate_404: false,
        },
        Probe {
            name: "assets-list",
            path: "/v1/assets",
            budget: Duration::from_millis(5_000),
            shape: Shape::ApiList,
            tolerate_404: false,
        },
        Probe {
            name: "peg-feed",
            path: "/v1/peg/feed",
            budget: Duration::from_millis(5_000),
            shape: Shape::PegFeed,
            tolerate_404: false,
        },
        Probe {
            name: "stats",
            path: "/v1/stats",
            budget: Duration::from_millis(4_000),
            shape: Shape::JsonObject,
            tolerate_404: false,
        },
        Probe {
            name: "methodology",
            path: "/v1/methodology/current",
            budget: Duration::from_millis(3_000),
            shape: Shape::JsonObject,
            tolerate_404: false,
        },
        Probe {
            name: "alerts",
            path: "/v1/alerts?limit=1",
            budget: Duration::from_millis(4_000),
            shape: Shape::ApiList,
            tolerate_404: false,
        },
        Probe {
            name: "openapi",
            path: "/openapi.json",
            budget: Duration::from_millis(4_000),
            shape: Shape::JsonObject,
            tolerate_404: false,
        },
    ]
}

#[derive(Serialize)]
struct ProbeResult {
    name: String,
    path: String,
    ok: bool,
    status: Option<u16>,
    duration_ms: u128,
    budget_ms: u128,
    attempts: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Serialize)]
struct Summary {
    event: &'static str,
    base: String,
    passed: usize,
    failed: usize,
    probes: Vec<ProbeResult>,
}

/// Assert the ADR-0043 list envelope. Returns the item array on success.
fn assert_api_list(body: &Value) -> Result<&Vec<Value>> {
    let obj = body
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("expected a JSON object envelope, got {}", kind_of(body)))?;
    if obj.get("ok").and_then(Value::as_bool) != Some(true) {
        bail!("envelope `ok` is not true");
    }
    if !obj.get("generated_at").is_some_and(Value::is_string) {
        bail!("envelope is missing a string `generated_at`");
    }
    let data = obj
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow::anyhow!("envelope `data` is not an array"))?;
    let count = obj
        .get("count")
        .and_then(Value::as_u64)
        .ok_or_else(|| anyhow::anyhow!("envelope is missing a numeric `count`"))?;
    if count as usize != data.len() {
        bail!("`count` is {count} but `data` has {} items", data.len());
    }
    Ok(data)
}

fn kind_of(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn assert_shape(shape: Shape, body: &Value) -> Result<()> {
    match shape {
        Shape::Any => Ok(()),
        Shape::JsonObject => {
            if body.is_object() {
                Ok(())
            } else {
                bail!("expected a JSON object, got {}", kind_of(body))
            }
        }
        Shape::ApiList => {
            assert_api_list(body)?;
            Ok(())
        }
        Shape::PegFeed => {
            let data = assert_api_list(body)?;
            if !body.get("methodology").is_some_and(Value::is_string) {
                bail!("peg feed is missing a string `methodology`");
            }
            // The mint is the join key partners index `data[]` by. A signal
            // without it is unusable downstream, so treat it as a contract break.
            if let Some(bad) = data
                .iter()
                .position(|s| !s.get("mint").is_some_and(Value::is_string))
            {
                bail!("peg feed signal at index {bad} has no string `mint`");
            }
            Ok(())
        }
    }
}

async fn run_probe(
    client: &reqwest::Client,
    base: &str,
    probe: &Probe,
    max_attempts: u32,
) -> ProbeResult {
    let url = format!("{}{}", base.trim_end_matches('/'), probe.path);
    let mut last_error = None;
    let mut last_status = None;
    let mut attempts = 0;

    for attempt in 1..=max_attempts {
        attempts = attempt;
        let started = Instant::now();
        let outcome = attempt_once(client, &url, probe).await;
        let elapsed = started.elapsed();

        match outcome {
            Ok(status) => {
                return ProbeResult {
                    name: probe.name.to_string(),
                    path: probe.path.to_string(),
                    ok: true,
                    status: Some(status),
                    duration_ms: elapsed.as_millis(),
                    budget_ms: probe.budget.as_millis(),
                    attempts,
                    error: None,
                }
            }
            Err((status, e)) => {
                last_status = status;
                last_error = Some(e.to_string());
                if attempt < max_attempts {
                    // Linear backoff: these are seconds-scale checks against a
                    // service that may still be warming, not a rate-limited API.
                    tokio::time::sleep(Duration::from_millis(1_000 * attempt as u64)).await;
                }
            }
        }
    }

    ProbeResult {
        name: probe.name.to_string(),
        path: probe.path.to_string(),
        ok: false,
        status: last_status,
        duration_ms: 0,
        budget_ms: probe.budget.as_millis(),
        attempts,
        error: last_error,
    }
}

/// One attempt. `Err((status, why))` carries the status when we got one.
async fn attempt_once(
    client: &reqwest::Client,
    url: &str,
    probe: &Probe,
) -> std::result::Result<u16, (Option<u16>, anyhow::Error)> {
    let started = Instant::now();
    let resp = match client.get(url).timeout(probe.budget * 2).send().await {
        Ok(r) => r,
        Err(e) => return Err((None, anyhow::anyhow!("request failed: {e}"))),
    };
    let status = resp.status();
    let code = status.as_u16();

    if code == 404 && probe.tolerate_404 {
        return Ok(code);
    }
    if !status.is_success() {
        return Err((Some(code), anyhow::anyhow!("HTTP {code}")));
    }

    let text = match resp.text().await {
        Ok(t) => t,
        Err(e) => return Err((Some(code), anyhow::anyhow!("body read failed: {e}"))),
    };
    // Read the clock AFTER the body lands: a response that streams headers fast
    // and then stalls mid-body is exactly the degradation this is meant to catch.
    let elapsed = started.elapsed();

    if !matches!(probe.shape, Shape::Any) {
        let body: Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(e) => return Err((Some(code), anyhow::anyhow!("invalid JSON: {e}"))),
        };
        if let Err(e) = assert_shape(probe.shape, &body) {
            return Err((Some(code), e));
        }
    }

    if elapsed > probe.budget {
        return Err((
            Some(code),
            anyhow::anyhow!(
                "over latency budget: {}ms > {}ms",
                elapsed.as_millis(),
                probe.budget.as_millis()
            ),
        ));
    }

    Ok(code)
}

pub async fn run(base: String, retries: u32, json: bool) -> Result<()> {
    let max_attempts = retries.max(1);
    let client = reqwest::Client::builder()
        .user_agent("pegana-xtask-smoke")
        .build()?;

    let all = probes();
    let mut results = Vec::with_capacity(all.len());
    for probe in &all {
        results.push(run_probe(&client, &base, probe, max_attempts).await);
    }

    let failed = results.iter().filter(|r| !r.ok).count();
    let passed = results.len() - failed;

    if json {
        let summary = Summary {
            event: "smoke_canary_summary",
            base: base.clone(),
            passed,
            failed,
            probes: results,
        };
        println!("{}", serde_json::to_string(&summary)?);
    } else {
        println!();
        println!("================== xtask smoke ==================");
        println!("base: {base}");
        for r in &results {
            let mark = if r.ok { "ok  " } else { "FAIL" };
            println!(
                "  [{mark}] {:<14} {:>6}ms / {:>5}ms  {}{}",
                r.name,
                r.duration_ms,
                r.budget_ms,
                r.status
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "-".into()),
                r.error
                    .as_ref()
                    .map(|e| format!("  · {e}"))
                    .unwrap_or_default()
            );
        }
        println!("passed: {passed}   failed: {failed}");
        println!("=================================================");
    }

    if failed > 0 {
        bail!("{failed} probe(s) failed against {base}");
    }
    Ok(())
}
