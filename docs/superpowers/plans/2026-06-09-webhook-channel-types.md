# Webhook Channel Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Discord (and Slack) webhooks actually deliver, by adding a `channel_type` that projects Pegana's canonical event onto channel-correct bodies (Discord embeds / Slack attachments / generic signed JSON), shared by `dispatcher-rs` and `api-rs`.

**Architecture:** One renderer in `pegana_common::webhook_channel` is the single source of truth. All send paths (production fan-out, `/test`, `/replay`) resolve the subscription's `channel_type`, call `render_for_channel`, and dispatch the projected body (signing only `generic`). The dead-letter store keeps the canonical event; replay re-renders. A migration adds the column + backfills existing rows. The production retry loop additionally honors `Retry-After` on 429.

**Tech Stack:** Rust (axum, sqlx runtime queries, reqwest, serde_json, url, ed25519-dalek), Postgres, `cargo test` against prod-local Postgres.

**Spec:** `docs/superpowers/specs/2026-06-09-webhook-channel-types-design.md`

**Conventions in this repo (read before starting):**
- sqlx uses the runtime `sqlx::query(...) + Row::get(...)` pattern, NOT the `query_as!` macro (no build-time `DATABASE_URL`). See `crates/dispatcher-rs/src/webhook_queries.rs:1-7`.
- Loopback HTTP sinks in tests require env `WEBHOOK_SSRF_ALLOW_LOOPBACK=1` (the SSRF guard otherwise rejects `127.0.0.1`).
- Tests that need a signing key set `PEGANA_WEBHOOK_SIGNING_KEY` to a base64 Ed25519 seed (see `crates/api-rs/src/webhook_dispatch.rs:271-277` for the exact `ensure_signing_key` pattern).
- Existing axum-sink test harness pattern: `crates/api-rs/src/webhook_dispatch.rs:228-339` and `crates/dispatcher-rs/tests/webhook_dispatch_headers.rs`.

---

## File Structure

**Create:**
- `crates/common/src/webhook_channel.rs` — `ChannelType`, `detect_channel_type`, `Rendered`, `render_for_channel`, channel projections, truncation. The only place a channel body is built.
- `migrations/0046_webhook_channel_type.sql` — add `channel_type` + CHECK + backfill.
- `crates/dispatcher-rs/tests/webhook_channel_dispatch.rs` — integration: discord/slack/generic dispatch, regression-lock, 429, mixed-channel + stress fan-out.

**Modify:**
- `crates/common/src/lib.rs:16-19` — register `pub mod webhook_channel;`.
- `crates/dispatcher-rs/src/webhook_queries.rs` — `Subscription` + `subs_for_asset` gain `channel_type`.
- `crates/dispatcher-rs/src/webhook.rs` — `dispatch_one` gains `sign: bool`; retry loop honors `Retry-After`.
- `crates/dispatcher-rs/src/main.rs:507-566` — `webhook_fanout` renders per `sub.channel_type`.
- `crates/api-rs/src/routes/webhooks.rs` — `Webhook`/`CreateWebhook`/`PatchWebhook` gain `channel_type`; create auto-detects; list/patch SELECT include it; `user_owned_sub` returns it; `test_webhook` + `replay_webhook` render per channel.
- `crates/api-rs/src/webhook_dispatch.rs` — `dispatch_once` gains `sign: bool`.

---

## Task 1: `ChannelType` + `detect_channel_type`

**Files:**
- Create: `crates/common/src/webhook_channel.rs`
- Modify: `crates/common/src/lib.rs:16-19`

- [ ] **Step 1: Register the module**

In `crates/common/src/lib.rs`, add to the module block (keep alphabetical):

```rust
pub mod observability;
pub mod webhook_channel;
pub mod webhook_response;
pub mod webhook_sign;
pub mod webhook_url;
```

- [ ] **Step 2: Write the failing test (module + detection)**

Create `crates/common/src/webhook_channel.rs` with ONLY the enum/detector skeleton and tests:

```rust
//! Channel projection for outbound webhooks. Single source of truth for
//! turning Pegana's canonical event JSON into a channel-correct body
//! (Discord embed / Slack attachment / generic signed JSON). Shared by
//! `dispatcher-rs` (production fan-out) and `api-rs` (test/replay).

use std::str::FromStr;

/// Destination flavor for a webhook subscription. `Generic` is a machine
/// receiver that verifies the Ed25519 signature; `Discord`/`Slack` are
/// chat sinks that render a message body and ignore our signature.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ChannelType {
    #[default]
    Generic,
    Discord,
    Slack,
}

impl std::fmt::Display for ChannelType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            ChannelType::Generic => "generic",
            ChannelType::Discord => "discord",
            ChannelType::Slack => "slack",
        })
    }
}

impl FromStr for ChannelType {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "generic" => Ok(ChannelType::Generic),
            "discord" => Ok(ChannelType::Discord),
            "slack" => Ok(ChannelType::Slack),
            other => Err(format!("unknown channel_type: {other}")),
        }
    }
}

/// Classify a subscriber URL by host. Conservative: exact host or
/// dot-suffix match only, so `discord.com.evil.com` falls through to
/// `Generic` (it is NOT a discord host). Unparseable URLs → `Generic`.
pub fn detect_channel_type(url: &str) -> ChannelType {
    let host = match url::Url::parse(url).ok().and_then(|u| u.host_str().map(str::to_owned)) {
        Some(h) => h.to_ascii_lowercase(),
        None => return ChannelType::Generic,
    };
    let is = |exact: &str, suffix: &str| host == exact || host.ends_with(suffix);
    if is("discord.com", ".discord.com") || is("discordapp.com", ".discordapp.com") {
        ChannelType::Discord
    } else if is("hooks.slack.com", ".slack.com") {
        ChannelType::Slack
    } else {
        ChannelType::Generic
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_known_hosts_and_rejects_spoofs() {
        let cases = [
            ("https://discord.com/api/webhooks/1/abc", ChannelType::Discord),
            ("https://discordapp.com/api/webhooks/1/abc", ChannelType::Discord),
            ("https://ptb.discord.com/api/webhooks/1/abc", ChannelType::Discord),
            ("https://hooks.slack.com/services/T/B/x", ChannelType::Slack),
            ("https://team.slack.com/x", ChannelType::Slack),
            // spoofs + unrelated → Generic
            ("https://discord.com.evil.com/x", ChannelType::Generic),
            ("https://notdiscord.com/x", ChannelType::Generic),
            ("https://my.app/pegana-hook", ChannelType::Generic),
            ("not a url", ChannelType::Generic),
        ];
        for (url, want) in cases {
            assert_eq!(detect_channel_type(url), want, "url={url}");
        }
    }

    #[test]
    fn roundtrips_string_form() {
        for ch in [ChannelType::Generic, ChannelType::Discord, ChannelType::Slack] {
            assert_eq!(ChannelType::from_str(&ch.to_string()).unwrap(), ch);
        }
        assert!(ChannelType::from_str("telegram").is_err());
    }
}
```

- [ ] **Step 3: Run the test to verify it passes (compile-driven)**

Run: `cargo test -p pegana-common webhook_channel -- --nocapture`
Expected: PASS (both tests). If `url` is not a dependency of `pegana-common`, add `url = "2"` to `crates/common/Cargo.toml` `[dependencies]` (it is already used by `webhook_url.rs`, so it should resolve — verify with `rg '^url' crates/common/Cargo.toml`).

- [ ] **Step 4: Commit**

```bash
git add crates/common/src/lib.rs crates/common/src/webhook_channel.rs
git commit -m "feat(common): ChannelType + detect_channel_type (webhook channel module)"
```

---

## Task 2: `render_for_channel` + Discord/Slack projections

**Files:**
- Modify: `crates/common/src/webhook_channel.rs`

- [ ] **Step 1: Write the failing tests**

Append to the `tests` module in `crates/common/src/webhook_channel.rs`:

```rust
    fn alert_canonical() -> serde_json::Value {
        serde_json::json!({
            "asset": "jitoSOL",
            "from_state": "PEGGED",
            "to_state": "DRIFT",
            "discount_bps": -47,
            "ts": "2026-06-09T00:00:00Z",
            "alert_id": "11111111-1111-1111-1111-111111111111",
            "evidence_url": "https://pegana.xyz/audit/11111111-1111-1111-1111-111111111111",
            "evidence_status": "ready"
        })
    }

    #[test]
    fn generic_is_unchanged_and_signed() {
        let c = alert_canonical();
        let r = render_for_channel(ChannelType::Generic, &c);
        assert!(r.sign, "generic must be signed");
        assert_eq!(r.body, c, "generic body must be byte-identical to canonical");
    }

    #[test]
    fn discord_alert_has_embed_and_is_unsigned() {
        let r = render_for_channel(ChannelType::Discord, &alert_canonical());
        assert!(!r.sign, "chat sinks are unsigned");
        let embeds = r.body.get("embeds").and_then(|v| v.as_array()).expect("embeds array");
        assert_eq!(embeds.len(), 1);
        let e = &embeds[0];
        assert_eq!(e["title"], "jitoSOL · DRIFT");
        assert_eq!(e["color"], 16098083); // amber for DRIFT
        assert!(e["description"].as_str().unwrap().contains("PEGGED"));
        assert!(e["url"].as_str().unwrap().ends_with("/audit/11111111-1111-1111-1111-111111111111"));
    }

    #[test]
    fn discord_color_tracks_severity() {
        let color = |to: &str| {
            let mut c = alert_canonical();
            c["to_state"] = serde_json::json!(to);
            render_for_channel(ChannelType::Discord, &c).body["embeds"][0]["color"].as_u64().unwrap()
        };
        assert_eq!(color("DEPEG"), 15025741);  // red
        assert_eq!(color("BLACK_SWAN"), 15025741);
        assert_eq!(color("DRIFT"), 16098083);  // amber
        assert_eq!(color("PEGGED"), 3187820);  // green (recovery)
    }

    #[test]
    fn slack_alert_has_attachment_and_is_unsigned() {
        let r = render_for_channel(ChannelType::Slack, &alert_canonical());
        assert!(!r.sign);
        let att = r.body.get("attachments").and_then(|v| v.as_array()).expect("attachments");
        assert_eq!(att.len(), 1);
        assert_eq!(att[0]["title"], "jitoSOL · DRIFT");
        assert_eq!(att[0]["color"], "#F5A623");
    }

    #[test]
    fn retraction_and_evidence_render_for_discord() {
        let retraction = serde_json::json!({
            "type": "retraction",
            "alert_id": "22222222-2222-2222-2222-222222222222",
            "original_alert_id": "22222222-2222-2222-2222-222222222222",
            "retraction_reason": "methodology bug",
            "retraction_evidence_url": "https://pegana.xyz/audit/22222222-2222-2222-2222-222222222222"
        });
        let r = render_for_channel(ChannelType::Discord, &retraction);
        assert!(r.body["embeds"][0]["title"].as_str().unwrap().contains("retract"));

        let evidence = serde_json::json!({
            "type": "evidence_now_available",
            "alert_id": "33333333-3333-3333-3333-333333333333",
            "evidence_url": "https://pegana.xyz/audit/33333333-3333-3333-3333-333333333333",
            "evidence_status": "ready"
        });
        let r = render_for_channel(ChannelType::Discord, &evidence);
        assert!(r.body["embeds"][0]["title"].as_str().unwrap().to_lowercase().contains("evidence"));
    }

    #[test]
    fn discord_truncates_pathological_fields() {
        let mut c = alert_canonical();
        c["retraction_reason"] = serde_json::json!("x".repeat(5000));
        c["type"] = serde_json::json!("retraction");
        let r = render_for_channel(ChannelType::Discord, &c);
        let desc = r.body["embeds"][0]["description"].as_str().unwrap();
        assert!(desc.chars().count() <= 4096, "description must respect Discord's 4096 limit");
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p pegana-common webhook_channel`
Expected: FAIL — `render_for_channel`/`Rendered` not found.

- [ ] **Step 3: Implement the renderer**

Insert above the `#[cfg(test)]` module in `crates/common/src/webhook_channel.rs`:

```rust
use serde_json::{json, Value};

/// A channel-projected body plus whether to attach the Ed25519 signature.
pub struct Rendered {
    pub body: Value,
    /// Only `Generic` is signed — chat sinks can't verify, and signing a
    /// body different from the documented canonical would misrepresent the
    /// signature contract.
    pub sign: bool,
}

// Discord embed limits (chars). Defensive even though our content is small.
const D_TITLE: usize = 256;
const D_DESC: usize = 4096;
const D_FIELD_VAL: usize = 1024;

/// Truncate on a char boundary, appending `…` when clamped.
fn clamp(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

fn str_field<'a>(c: &'a Value, k: &str) -> &'a str {
    c.get(k).and_then(Value::as_str).unwrap_or("")
}

/// Project a canonical Pegana event onto `ch`. The canonical event is the
/// existing generic JSON (peg alert) or a `{type: "retraction" |
/// "evidence_now_available", …}` object. Never mutates `canonical`.
pub fn render_for_channel(ch: ChannelType, canonical: &Value) -> Rendered {
    match ch {
        ChannelType::Generic => Rendered { body: canonical.clone(), sign: true },
        ChannelType::Discord => Rendered { body: discord_body(canonical), sign: false },
        ChannelType::Slack => Rendered { body: slack_body(canonical), sign: false },
    }
}

fn discount_line(c: &Value) -> String {
    match c.get("discount_bps").and_then(Value::as_i64) {
        Some(bps) => format!("discount {bps} bps ({:+.2}%)", bps as f64 / 100.0),
        None => String::new(),
    }
}

/// (title, description, url, color) for the canonical event.
fn summarize(c: &Value) -> (String, String, String, u64) {
    let asset = str_field(c, "asset");
    let url_for = |k: &str| str_field(c, k).to_string();
    match c.get("type").and_then(Value::as_str) {
        Some("retraction") => (
            format!("Alert retracted · {}", str_field(c, "original_alert_id")),
            clamp(
                &format!("Retraction: {}", str_field(c, "retraction_reason")),
                D_DESC,
            ),
            url_for("retraction_evidence_url"),
            9807270, // neutral slate 0x95A5A6
        ),
        Some("evidence_now_available") => (
            "Evidence now available".to_string(),
            "The audit receipt for a prior alert is now retrievable.".to_string(),
            url_for("evidence_url"),
            3447003, // blue 0x3498DB
        ),
        _ => {
            let from = str_field(c, "from_state");
            let to = str_field(c, "to_state");
            let mut desc = format!("Peg {from} → {to}");
            let dl = discount_line(c);
            if !dl.is_empty() {
                desc = format!("{desc} · {dl}");
            }
            (
                format!("{asset} · {to}"),
                desc,
                url_for("evidence_url"),
                discord_color(to),
            )
        }
    }
}

/// Severity → Discord embed color (decimal RGB).
fn discord_color(to_state: &str) -> u64 {
    match to_state {
        "DEPEG" | "BLACK_SWAN" => 15025741, // red    0xE5444D-ish
        "DRIFT" => 16098083,                // amber  0xF5A623
        "PEGGED" => 3187820,                // green  0x30A46C
        _ => 9807270,                       // slate  0x95A5A6
    }
}

fn discord_body(c: &Value) -> Value {
    let (title, description, url, color) = summarize(c);
    let mut embed = json!({
        "title": clamp(&title, D_TITLE),
        "description": clamp(&description, D_DESC),
        "color": color,
        "footer": { "text": format!("Pegana · evidence: {}", str_field(c, "evidence_status")) },
    });
    if let Some(ts) = c.get("ts").and_then(Value::as_str) {
        embed["timestamp"] = json!(ts);
    }
    if !url.is_empty() {
        embed["url"] = json!(url);
    }
    // Inline fields for a peg alert only.
    if c.get("type").is_none() {
        embed["fields"] = json!([
            { "name": "Asset", "value": clamp(str_field(c, "asset"), D_FIELD_VAL), "inline": true },
            { "name": "Transition",
              "value": clamp(&format!("{} → {}", str_field(c, "from_state"), str_field(c, "to_state")), D_FIELD_VAL),
              "inline": true },
        ]);
    }
    json!({ "embeds": [embed] })
}

fn slack_color(to_state: &str) -> &'static str {
    match to_state {
        "DEPEG" | "BLACK_SWAN" => "#E5444D",
        "DRIFT" => "#F5A623",
        "PEGGED" => "#30A46C",
        _ => "#95A5A6",
    }
}

fn slack_body(c: &Value) -> Value {
    let (title, description, url, _color) = summarize(c);
    let color = match c.get("type").and_then(Value::as_str) {
        Some("retraction") => "#95A5A6",
        Some("evidence_now_available") => "#3498DB",
        _ => slack_color(str_field(c, "to_state")),
    };
    let mut att = json!({
        "color": color,
        "title": clamp(&title, D_TITLE),
        "text": clamp(&description, D_DESC),
        "footer": "Pegana",
    });
    if !url.is_empty() {
        att["title_link"] = json!(url);
    }
    json!({ "attachments": [att] })
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test -p pegana-common webhook_channel`
Expected: PASS (all tests). If the DRIFT color assertion fails, reconcile the constant — the test is the source of truth for the numeric values.

- [ ] **Step 5: Commit**

```bash
git add crates/common/src/webhook_channel.rs
git commit -m "feat(common): render_for_channel — Discord embeds + Slack attachments"
```

---

## Task 3: Migration 0046 — `channel_type` column + backfill

**Files:**
- Create: `migrations/0046_webhook_channel_type.sql`

- [ ] **Step 1: Write the migration**

Create `migrations/0046_webhook_channel_type.sql`:

```sql
-- 0046: webhook channel types (generic | discord | slack).
--
-- Pegana sent every webhook as generic signed JSON, which Discord/Slack
-- reject (they require channel-shaped bodies). This column lets the
-- dispatcher + api render per destination. Default 'generic' keeps every
-- existing machine receiver byte-for-byte unchanged.

ALTER TABLE webhook_subscriptions
    ADD COLUMN IF NOT EXISTS channel_type TEXT NOT NULL DEFAULT 'generic';

ALTER TABLE webhook_subscriptions
    DROP CONSTRAINT IF EXISTS webhook_subscriptions_channel_type_chk;
ALTER TABLE webhook_subscriptions
    ADD CONSTRAINT webhook_subscriptions_channel_type_chk
    CHECK (channel_type IN ('generic', 'discord', 'slack'));

-- Best-effort backfill so already-registered Discord/Slack hooks start
-- working on deploy. Coarser than the Rust detector (host parsing in SQL
-- is approximate); any miss is correctable via PATCH, and every NEW
-- registration uses the exact Rust detector.
UPDATE webhook_subscriptions
   SET channel_type = 'discord'
 WHERE channel_type = 'generic'
   AND (url LIKE 'https://discord.com/%'
     OR url LIKE 'https://discordapp.com/%'
     OR url LIKE 'https://%.discord.com/%'
     OR url LIKE 'https://%.discordapp.com/%');

UPDATE webhook_subscriptions
   SET channel_type = 'slack'
 WHERE channel_type = 'generic'
   AND (url LIKE 'https://hooks.slack.com/%'
     OR url LIKE 'https://%.slack.com/%');
```

- [ ] **Step 2: Apply against prod-local Postgres and verify**

Run (matches the repo's prod-local stack on :5434):
```bash
psql "postgres://pegana:pegana@localhost:5434/pegana" -f migrations/0046_webhook_channel_type.sql
psql "postgres://pegana:pegana@localhost:5434/pegana" -c "\d webhook_subscriptions" | grep channel_type
```
Expected: the `\d` output shows `channel_type | text | not null | 'generic'::text`. (If the local DB password/port differ, use the values from `docker-compose.local.yml`.)

- [ ] **Step 3: Commit**

```bash
git add migrations/0046_webhook_channel_type.sql
git commit -m "feat(db): migration 0046 — webhook_subscriptions.channel_type + backfill"
```

---

## Task 4: dispatcher-rs — thread `channel_type` + `sign` flag

**Files:**
- Modify: `crates/dispatcher-rs/src/webhook_queries.rs:19-55`
- Modify: `crates/dispatcher-rs/src/webhook.rs:93-200`
- Modify: `crates/dispatcher-rs/src/main.rs:507-566`

- [ ] **Step 1: Add `channel_type` to the Subscription query**

In `crates/dispatcher-rs/src/webhook_queries.rs`, replace the `Subscription` struct and `subs_for_asset` mapper:

```rust
use pegana_common::webhook_channel::ChannelType;
use std::str::FromStr;

#[allow(dead_code)]
pub struct Subscription {
    pub id: Uuid,
    pub url: String,
    pub asset: String,
    pub threshold_bps: i32,
    pub channel_type: ChannelType,
}
```

And update the SELECT + mapper in `subs_for_asset`:

```rust
    let rows = sqlx::query(
        r#"SELECT id, url, asset, threshold_bps, channel_type
           FROM webhook_subscriptions
           WHERE asset = $1 AND is_active = TRUE AND $2 >= threshold_bps"#,
    )
    .bind(asset)
    .bind(discount_bps.abs())
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| Subscription {
            id: r.get("id"),
            url: r.get("url"),
            asset: r.get("asset"),
            threshold_bps: r.get("threshold_bps"),
            channel_type: ChannelType::from_str(&r.get::<String, _>("channel_type"))
                .unwrap_or_default(),
        })
        .collect())
```

- [ ] **Step 2: Add `sign: bool` to `dispatch_one`**

In `crates/dispatcher-rs/src/webhook.rs`, change the signature (line ~93) to add the param:

```rust
pub async fn dispatch_one(
    cfg: &DispatchConfig,
    pg: Option<&PgPool>,
    subscription_id: Uuid,
    url: &str,
    alert_id: Uuid,
    payload: &Value,
    sign: bool,
) -> Result<u16, String> {
```

Replace the signing + header block (lines ~111-141) so the signature is conditional:

```rust
    let body = serde_json::to_string(payload).map_err(|e| e.to_string())?;
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs()
        .to_string();
    let sig = if sign {
        Some(sign_payload(&cfg.signing_keys.primary, &ts, &body))
    } else {
        None
    };

    let mut backoffs = RETRY_BACKOFFS_SEC.iter().copied().map(Duration::from_secs);
    let mut last_err = String::new();

    for attempt in 1..=cfg.max_attempts {
        let delivery_id = Uuid::new_v4();
        let started = std::time::Instant::now();
        let mut req = cfg
            .http
            .post(url)
            .header("x-pegana-event-id", alert_id.to_string())
            .header("x-pegana-delivery-id", delivery_id.to_string())
            .header("x-pegana-attempt", format!("{}/{}", attempt, cfg.max_attempts))
            .header("content-type", "application/json")
            .body(body.clone())
            .timeout(Duration::from_secs(5));
        if let Some(ref s) = sig {
            req = req
                .header("x-pegana-signature", format!("ed25519:{s}"))
                .header("x-pegana-timestamp", &ts);
        }
        let res = req.send().await;
```

- [ ] **Step 3: Honor `Retry-After` in the retry loop**

Still in `webhook.rs`, in the `Ok(r)` non-success arm capture the hint BEFORE consuming the body, and use it for the sleep. Add a const near `RETRY_BACKOFFS_SEC`:

```rust
/// Cap on a receiver-supplied `Retry-After` so a hostile/broken 429 can't
/// pin a permit for longer than our own envelope.
const MAX_BACKOFF_SECS: u64 = 7200;
```

Add a helper at module scope:

```rust
/// Parse a `Retry-After` header as whole seconds (integer or float form),
/// clamped to `MAX_BACKOFF_SECS`. Returns `None` if absent/unparseable.
fn parse_retry_after(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    let raw = headers.get(reqwest::header::RETRY_AFTER)?.to_str().ok()?;
    let secs = raw
        .trim()
        .parse::<u64>()
        .ok()
        .or_else(|| raw.trim().parse::<f64>().ok().map(|f| f.ceil() as u64))?;
    Some(secs.min(MAX_BACKOFF_SECS))
}
```

Replace the non-success arm + the inter-attempt sleep so the loop tracks an override. Declare `let mut retry_after: Option<u64> = None;` at the top of each iteration (reset per attempt), set it on 429, and use it when sleeping:

```rust
            Ok(r) => {
                let status = r.status();
                let status_u16 = status.as_u16();
                if status_u16 == 429 {
                    retry_after = parse_retry_after(r.headers());
                }
                last_err = format!("http {}: {}", status, read_truncated_body(r).await);
                record_delivery(
                    pg, subscription_id, alert_id, attempt as i16,
                    Some(status_u16 as i16), elapsed_ms, Some(&last_err), false,
                )
                .await;
            }
```

and the sleep:

```rust
        if attempt < cfg.max_attempts {
            let curve = backoffs.next();
            let delay = match retry_after {
                Some(s) => Duration::from_secs(s),
                None => curve.unwrap_or(Duration::from_secs(MAX_BACKOFF_SECS)),
            };
            sleep(delay).await;
        }
```

(Declare `let mut retry_after: Option<u64> = None;` as the first line inside `for attempt in …`.)

- [ ] **Step 4: Render per channel in `webhook_fanout`**

In `crates/dispatcher-rs/src/main.rs`, inside the `tokio::spawn` body of `webhook_fanout` (lines ~514-562), after building the canonical `payload`, render and pass `sign`:

```rust
            use pegana_common::webhook_channel::render_for_channel;
            let canonical = serde_json::json!({
                "asset": evt.asset,
                "from_state": evt.from_state,
                "to_state": evt.to_state,
                "discount_bps": (decimal_to_f64(evt.discount) * 10_000.0) as i64,
                "ts": evt.detected_at,
                "alert_id": evt.id,
                "evidence_url": format!("{}/audit/{}", cfg.audit_base_url, evt.id),
                "evidence_status": evidence_status,
            });
            let rendered = render_for_channel(sub.channel_type, &canonical);
            // ... existing comment block ...
            match dispatch_one(&cfg, Some(&pool), sub.id, &sub.url, evt.id, &rendered.body, rendered.sign).await {
```

And update the dead-letter call to store the **canonical** (not the rendered body) so replay can re-render:

```rust
                Err(err) => {
                    let _ = record_dead_letter(&pool, sub.id, evt.id, canonical, &err, cfg.max_attempts as i16).await;
```

(Note: `canonical` is moved here; `rendered` already borrowed it by value via clone in Generic. Since `render_for_channel` takes `&canonical`, `canonical` is still owned and movable into `record_dead_letter`.)

- [ ] **Step 5: Update existing dispatcher tests that call `dispatch_one`**

Run `rg -n "dispatch_one\(" crates/dispatcher-rs` and add `, true` (sign) as the final argument to each existing call in `crates/dispatcher-rs/tests/webhook_dispatch_headers.rs` and any others. The existing header tests assert the signature is present → they should pass `true`.

- [ ] **Step 6: Build + run dispatcher tests**

Run: `cargo test -p dispatcher-rs`
Expected: PASS. Fix any call-site arity errors surfaced by the compiler (Step 5).

- [ ] **Step 7: Commit**

```bash
git add crates/dispatcher-rs/src/webhook_queries.rs crates/dispatcher-rs/src/webhook.rs crates/dispatcher-rs/src/main.rs crates/dispatcher-rs/tests/
git commit -m "feat(dispatcher): render per channel_type, conditional signing, honor Retry-After"
```

---

## Task 5: api-rs — `channel_type` in CRUD + render in test/replay

**Files:**
- Modify: `crates/api-rs/src/routes/webhooks.rs` (Webhook/CreateWebhook/PatchWebhook structs, list/create/patch/test/replay handlers, `user_owned_sub`)
- Modify: `crates/api-rs/src/webhook_dispatch.rs:73-173` (`dispatch_once` gains `sign`)

- [ ] **Step 1: Add `sign` to `dispatch_once`**

In `crates/api-rs/src/webhook_dispatch.rs`, add `sign: bool` to the signature (line ~73) and make the signature header conditional (mirror Task 4 Step 2):

```rust
pub async fn dispatch_once(
    http: &reqwest::Client,
    pg: Option<&PgPool>,
    subscription_id: Option<Uuid>,
    url: &str,
    event_id: Uuid,
    payload: &Value,
    sign: bool,
    is_test: bool,
) -> DeliveryResult {
```

Replace the request-build block (lines ~125-143):

```rust
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string());

    let mut req = http
        .post(url)
        .header("x-pegana-event-id", event_id.to_string())
        .header("x-pegana-delivery-id", delivery_id.to_string())
        .header("x-pegana-attempt", "1/1")
        .header("content-type", "application/json")
        .body(body)
        .timeout(Duration::from_secs(5));
    if sign {
        let sig = sign_payload(&signing_keys().primary, &ts, /* body moved above — see note */ "");
        req = req
            .header("x-pegana-signature", format!("ed25519:{sig}"))
            .header("x-pegana-timestamp", &ts);
    }
    if is_test {
        req = req.header("x-pegana-test", "true");
    }
```

> **Note for the implementer:** `body` is moved into `.body(body)`. Compute `sig` from the `body` String BEFORE the `.body(body)` move (compute `let sig = if sign { Some(sign_payload(&signing_keys().primary, &ts, &body)) } else { None };` immediately after `body` is built and `ts` is computed, then reference `sig` in the header block). Adjust ordering so there is no use-after-move — the existing code already computes `sig` before the builder; keep that ordering and just gate it behind `sign`.

Update the two inline tests at the bottom of this file that call `dispatch_once(...)` to pass the new `sign` arg: the `test_send_sets_x_pegana_test_header` test passes `true, true` (sign, is_test); `replay_does_not_set_test_header` passes `true, false`. Add one assertion to a new test (or extend) that with `sign=false` there is no `x-pegana-signature` header.

- [ ] **Step 2: Write the failing API test (create auto-detects discord)**

Add to `crates/api-rs/src/routes/webhooks.rs` tests (or the existing api-rs integration test file for webhooks — check `rg -l "create_webhook|/v1/me/webhooks" crates/api-rs/tests`). The unit-level assertion we can make without a DB is on `detect_channel_type`; the create-path auto-detect is covered by the integration test in Task 6. For this task, the failing test is a compile-level contract: the `Webhook` response struct must carry `channel_type`. Write:

```rust
#[test]
fn webhook_response_serializes_channel_type() {
    let w = Webhook {
        id: Uuid::nil(),
        url: "https://discord.com/api/webhooks/1/x".into(),
        asset: "jitoSOL".into(),
        threshold_bps: 100,
        is_active: true,
        channel_type: "discord".into(),
    };
    let v = serde_json::to_value(&w).unwrap();
    assert_eq!(v["channel_type"], "discord");
}
```

(Add `#[cfg(test)] mod tests { use super::*; use uuid::Uuid; ... }` at the end of the file if none exists.)

- [ ] **Step 3: Run to verify it fails**

Run: `cargo test -p api-rs webhook_response_serializes_channel_type`
Expected: FAIL — `Webhook` has no field `channel_type`.

- [ ] **Step 4: Add `channel_type` to the structs**

In `crates/api-rs/src/routes/webhooks.rs`:

```rust
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Webhook {
    pub id: Uuid,
    pub url: String,
    pub asset: String,
    pub threshold_bps: i32,
    pub is_active: bool,
    /// "generic" | "discord" | "slack". Auto-detected from the URL on
    /// create when omitted; overridable via PATCH.
    pub channel_type: String,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CreateWebhook {
    pub url: String,
    pub asset: String,
    pub threshold_bps: i32,
    /// Optional. When omitted, the server detects it from the URL host.
    #[serde(default)]
    pub channel_type: Option<String>,
}
```

Add `channel_type: Option<String>` to `PatchWebhook` too:

```rust
    /// Override the channel flavor ("generic"|"discord"|"slack").
    pub channel_type: Option<String>,
```

- [ ] **Step 5: Validate + resolve channel_type, and update every SELECT/INSERT**

Add a validator near `validate_threshold`:

```rust
use pegana_common::webhook_channel::{detect_channel_type, ChannelType};
use std::str::FromStr;

/// Resolve the channel_type to store: explicit (validated) or detected.
fn resolve_channel_type(explicit: &Option<String>, url: &str) -> Result<String, (StatusCode, String)> {
    match explicit {
        Some(s) => ChannelType::from_str(s)
            .map(|c| c.to_string())
            .map_err(|e| (StatusCode::BAD_REQUEST, e)),
        None => Ok(detect_channel_type(url).to_string()),
    }
}
```

`create_webhook` — resolve + persist + return it:

```rust
    validate_subscriber_url(&body.url)?;
    validate_threshold(body.threshold_bps)?;
    let channel_type = resolve_channel_type(&body.channel_type, &body.url)?;
    let user_id = resolve_user_id(&state, &user).await?;
    let row = sqlx::query(
        "INSERT INTO webhook_subscriptions
           (user_id, url, asset, threshold_bps, channel_type)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, url, asset)
         DO UPDATE SET threshold_bps = EXCLUDED.threshold_bps,
                       channel_type = EXCLUDED.channel_type,
                       is_active = TRUE
         RETURNING id, url, asset, threshold_bps, is_active, channel_type",
    )
    .bind(user_id)
    .bind(&body.url)
    .bind(&body.asset)
    .bind(body.threshold_bps)
    .bind(&channel_type)
    .fetch_one(&state.pg)
    .await
    .map_err(internal)?;
```

In every `Webhook { … }` constructor in this file (list, create, patch), add `channel_type: row.get("channel_type")`. Add `channel_type` to the SELECT/RETURNING column lists in `list_webhooks` and `patch_webhook`. For `patch_webhook`, validate when present and thread into the UPDATE:

```rust
    if let Some(ref ct) = body.channel_type {
        ChannelType::from_str(ct).map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    }
    // ... in the UPDATE, add: channel_type = COALESCE($6, channel_type)
    // ... RETURNING ..., channel_type ; bind body.channel_type.as_deref() as $6
```

- [ ] **Step 6: Render per channel in `test_webhook` + `replay_webhook`**

Change `user_owned_sub` to also return `channel_type`:

```rust
async fn user_owned_sub(
    state: &Arc<AppState>,
    user: &AuthUser,
    sub_id: Uuid,
) -> Result<(i64, String, String, ChannelType), (StatusCode, String)> {
    let user_id = resolve_user_id(state, user).await?;
    let row = sqlx::query(
        "SELECT user_id, url, asset, channel_type
         FROM webhook_subscriptions
         WHERE id = $1 AND user_id = $2 AND is_active = TRUE",
    )
    .bind(sub_id)
    .bind(user_id)
    .fetch_optional(&state.pg)
    .await
    .map_err(internal)?
    .ok_or((StatusCode::NOT_FOUND, "webhook not found".into()))?;
    let ct = ChannelType::from_str(&row.get::<String, _>("channel_type")).unwrap_or_default();
    Ok((user_id, row.get("url"), row.get("asset"), ct))
}
```

`test_webhook` — render the synthetic canonical:

```rust
    let (_user_id, url, asset, channel_type) = user_owned_sub(&state, &user, id).await?;
    let event_id = Uuid::new_v4();
    let canonical = synthetic_payload(&asset, event_id);
    let rendered = pegana_common::webhook_channel::render_for_channel(channel_type, &canonical);
    let result = dispatch_once(&state.http, Some(&state.pg), Some(id), &url, event_id, &rendered.body, rendered.sign, true).await;
    Ok(Json(result))
```

In `replay_webhook`, the dead-letter rows store the **canonical** payload; resolve the sub's `channel_type` once (it is already fetched via `user_owned_sub` or the replay's own sub lookup — reuse it) and render each row's payload before `dispatch_once`, passing `rendered.body, rendered.sign`. Find the existing `dispatch_once(` call in `replay_webhook` (around line ~440) and wrap its payload with `render_for_channel(channel_type, &row_payload)`.

- [ ] **Step 7: Run to verify it passes**

Run: `cargo test -p api-rs webhook`
Expected: PASS (struct test + the two updated dispatch tests). Fix compiler-surfaced arity errors on `dispatch_once` call sites.

- [ ] **Step 8: Commit**

```bash
git add crates/api-rs/src/routes/webhooks.rs crates/api-rs/src/webhook_dispatch.rs
git commit -m "feat(api): channel_type in webhook CRUD + render test/replay per channel"
```

---

## Task 6: Integration + regression-lock + stress

**Files:**
- Create: `crates/dispatcher-rs/tests/webhook_channel_dispatch.rs`

- [ ] **Step 1: Write the regression-lock + channel integration test**

Create `crates/dispatcher-rs/tests/webhook_channel_dispatch.rs`. It boots an axum sink that mimics **Discord's contract** (400 when body lacks `content`/`embeds`, else 204), proving the OLD generic body fails and the NEW discord body passes. Uses `WEBHOOK_SSRF_ALLOW_LOOPBACK=1`.

```rust
//! Channel-projection integration tests. A sink that enforces Discord's
//! "must have content/embeds" contract is the regression lock for the
//! original silent-404 bug.

use axum::{extract::State, http::StatusCode, routing::post, Json, Router};
use pegana_common::webhook_channel::{render_for_channel, ChannelType};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;

#[derive(Clone, Default)]
struct Sink {
    bodies: Arc<Mutex<Vec<Value>>>,
}

// Mimics Discord: 400 "Cannot send an empty message" unless content/embeds present.
async fn discord_like(State(s): State<Sink>, Json(b): Json<Value>) -> StatusCode {
    s.bodies.lock().unwrap().push(b.clone());
    let ok = b.get("content").is_some() || b.get("embeds").is_some();
    if ok { StatusCode::NO_CONTENT } else { StatusCode::BAD_REQUEST }
}

async fn boot() -> (String, Sink) {
    std::env::set_var("WEBHOOK_SSRF_ALLOW_LOOPBACK", "1");
    let sink = Sink::default();
    let app = Router::new().route("/", post(discord_like)).with_state(sink.clone());
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap(); });
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    (format!("http://{addr}/"), sink)
}

fn canonical() -> Value {
    serde_json::json!({
        "asset": "jitoSOL", "from_state": "PEGGED", "to_state": "DRIFT",
        "discount_bps": -47, "ts": "2026-06-09T00:00:00Z",
        "alert_id": "11111111-1111-1111-1111-111111111111",
        "evidence_url": "https://pegana.xyz/audit/x", "evidence_status": "ready"
    })
}

#[tokio::test]
async fn discord_body_is_accepted_generic_body_is_rejected() {
    let (url, _sink) = boot().await;
    let http = reqwest::Client::new();

    // OLD behavior: generic canonical → Discord 400.
    let generic = render_for_channel(ChannelType::Generic, &canonical());
    let r = http.post(&url).json(&generic.body).send().await.unwrap();
    assert_eq!(r.status(), 400, "generic body must be rejected by a Discord-contract sink");

    // NEW behavior: discord projection → 204.
    let discord = render_for_channel(ChannelType::Discord, &canonical());
    let r = http.post(&url).json(&discord.body).send().await.unwrap();
    assert_eq!(r.status(), 204, "discord embed body must be accepted");
}
```

- [ ] **Step 2: Add the 429 Retry-After test**

Append a test that boots a sink returning `429 + Retry-After: 1` on the first hit and `204` after, calls `dispatcher_rs::webhook::dispatch_one` (import path: confirm the crate exposes it via `lib.rs` — `rg "pub use|pub mod webhook" crates/dispatcher-rs/src/lib.rs`), and asserts total elapsed ≥ ~1s and final `Ok(204)`. If `dispatch_one` is not public from the lib target, assert the behavior via the sink hit-count + timing using a thin wrapper, or mark this as `#[ignore]` with a note and cover Retry-After in a `webhook.rs` inline unit test instead (preferred: add the inline unit test in `webhook.rs` where `dispatch_one` is in-scope).

```rust
// In crates/dispatcher-rs/src/webhook.rs #[cfg(test)] mod tests:
#[tokio::test]
async fn honors_retry_after_on_429() {
    // boot a sink: attempt 1 -> 429 Retry-After: 1 ; attempt 2 -> 204
    // call dispatch_one(.., sign=false) ; assert elapsed >= 1s and Ok(204)
    // (full body mirrors the api-rs axum-sink pattern; use an AtomicUsize hit counter)
}
```

- [ ] **Step 3: Add the mixed-channel stress test**

Append a stress test: insert 200 subscriptions (mix of generic/discord/slack) — or, if avoiding a DB, drive `render_for_channel` + `dispatch_one` against the sink for 200 concurrent tasks bounded by a `tokio::sync::Semaphore::new(50)` — and assert no panics, all 200 land, and discord/slack bodies are channel-valid (sink records them; assert each has `embeds`/`attachments`/signed-generic respectively). Keep it deterministic (no `Math.random`-style flake): vary channel by `i % 3`.

- [ ] **Step 4: Run the integration suite**

Run: `WEBHOOK_SSRF_ALLOW_LOOPBACK=1 cargo test -p dispatcher-rs --test webhook_channel_dispatch -- --nocapture`
Expected: PASS. The regression-lock test is the proof the original bug is fixed.

- [ ] **Step 5: Commit**

```bash
git add crates/dispatcher-rs/tests/webhook_channel_dispatch.rs crates/dispatcher-rs/src/webhook.rs
git commit -m "test(dispatcher): Discord-contract regression lock + 429 + mixed-channel stress"
```

---

## Task 7: Final gate — fmt, clippy, full suite, OpenAPI

**Files:** none new (verification + any doc-comment fixes)

- [ ] **Step 1: Format + lint**

Run:
```bash
cargo fmt --all
cargo clippy -p pegana-common -p api-rs -p dispatcher-rs --all-targets -- -D warnings
```
Expected: no diffs from fmt after commit; clippy clean. Fix any warnings inline.

- [ ] **Step 2: Full workspace test**

Run: `WEBHOOK_SSRF_ALLOW_LOOPBACK=1 cargo test -p pegana-common -p api-rs -p dispatcher-rs`
Expected: all green. If any api-rs test needs Postgres, run the prod-local stack first (`docker compose -f docker-compose.local.yml up -d postgres`).

- [ ] **Step 3: Verify OpenAPI is consistent (no route count change)**

Run `rg -n "paths.len|webhooks" crates/api-rs/tests` to find the OpenAPI assertion test (if present). The number of paths must be UNCHANGED (we added schema fields, not routes). If a test asserts a specific schema shape for `Webhook`/`CreateWebhook`, update it to include `channel_type`. Run that test.

- [ ] **Step 4: Release-profile compile (matches deploy)**

Run: `cargo build --release -p api-rs -p dispatcher-rs`
Expected: success (the deploy builds release binaries).

- [ ] **Step 5: Commit any fmt/lint/doc fixups**

```bash
git add -A
git commit -m "chore(webhooks): fmt + clippy + OpenAPI schema for channel_type"
```

---

## Deploy (after review — not part of TDD loop)

`scripts/deploy.sh --migrate --services 'api dispatcher'` — applies migration 0046 and recreates only `api` + `dispatcher`. **Never touches engine/indexer** (calibration-safe). Verify post-deploy: register a Discord hook in prod, hit `POST /v1/me/webhooks/{id}/test`, confirm the message renders in the Discord channel and `DeliveryResult.http_status == 204`.

---

## Self-Review

**Spec coverage:**
- channel renderer (single source of truth) → Task 1+2 ✓
- Discord embeds + Slack attachments + colors + truncation → Task 2 ✓
- canonical-stays-store-of-record + replay re-render → Task 4 Step 4, Task 5 Step 6 ✓
- sign only generic → Task 2 (`Rendered.sign`), Task 4/5 (conditional header) ✓
- 429 Retry-After → Task 4 Step 3 ✓
- migration 0046 + backfill → Task 3 ✓
- API contract (create auto-detect/override, patch, list, test) → Task 5 ✓
- tests: unit/integration/regression-lock/429/stress → Task 2, 6 ✓
- calibration-safe deploy → Deploy section ✓

**Type consistency:** `ChannelType` (common) used by dispatcher `Subscription.channel_type` and api `resolve_channel_type`/`user_owned_sub`. `Rendered { body, sign }` consumed identically in both crates. `dispatch_one(.., sign)` (dispatcher) and `dispatch_once(.., sign, is_test)` (api) — note the api variant keeps its trailing `is_test` AFTER `sign`; call sites updated in Task 5 Step 1 + 6.

**Placeholder scan:** Task 6 Step 2/3 intentionally describe the sink wiring in prose because the exact harness mirrors an existing in-repo pattern (`webhook_dispatch.rs` tests) — the implementer copies that boot/sink scaffold. All other steps carry literal code.
