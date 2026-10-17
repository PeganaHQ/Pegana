//! Channel projection for outbound webhooks. Single source of truth for
//! turning Pegana's canonical event JSON into a channel-correct body
//! (Discord embed / Slack attachment / generic signed JSON). Shared by
//! `dispatcher-rs` (production fan-out) and `api-rs` (test/replay).
//!
//! The canonical event is the existing generic JSON (a peg alert) or a
//! `{type: "retraction" | "evidence_now_available", …}` object. Discord
//! and Slack bodies are pure projections — the canonical is never mutated,
//! and it stays the store-of-record in `webhook_dead_letter` so replay
//! re-renders per the subscription's current channel.

use serde_json::{json, Value};
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
    let host = match url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_owned))
    {
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

/// Project a canonical Pegana event onto `ch`. Never mutates `canonical`.
pub fn render_for_channel(ch: ChannelType, canonical: &Value) -> Rendered {
    match ch {
        ChannelType::Generic => Rendered {
            body: canonical.clone(),
            sign: true,
        },
        ChannelType::Discord => Rendered {
            body: discord_body(canonical),
            sign: false,
        },
        ChannelType::Slack => Rendered {
            body: slack_body(canonical),
            sign: false,
        },
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
        "DEPEG" | "BLACK_SWAN" => 15025741, // red    0xE5444D
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
    // Inline fields for a peg alert only (events with no `type` discriminator).
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_known_hosts_and_rejects_spoofs() {
        let cases = [
            (
                "https://discord.com/api/webhooks/1/abc",
                ChannelType::Discord,
            ),
            (
                "https://discordapp.com/api/webhooks/1/abc",
                ChannelType::Discord,
            ),
            (
                "https://ptb.discord.com/api/webhooks/1/abc",
                ChannelType::Discord,
            ),
            ("https://hooks.slack.com/services/T/B/x", ChannelType::Slack),
            ("https://team.slack.com/x", ChannelType::Slack),
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
        for ch in [
            ChannelType::Generic,
            ChannelType::Discord,
            ChannelType::Slack,
        ] {
            assert_eq!(ChannelType::from_str(&ch.to_string()).unwrap(), ch);
        }
        assert!(ChannelType::from_str("telegram").is_err());
    }

    fn alert_canonical() -> Value {
        json!({
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
        assert_eq!(
            r.body, c,
            "generic body must be byte-identical to canonical"
        );
    }

    #[test]
    fn discord_alert_has_embed_and_is_unsigned() {
        let r = render_for_channel(ChannelType::Discord, &alert_canonical());
        assert!(!r.sign, "chat sinks are unsigned");
        let embeds = r
            .body
            .get("embeds")
            .and_then(|v| v.as_array())
            .expect("embeds array");
        assert_eq!(embeds.len(), 1);
        let e = &embeds[0];
        assert_eq!(e["title"], "jitoSOL · DRIFT");
        assert_eq!(e["color"], 16098083); // amber for DRIFT
        assert!(e["description"].as_str().unwrap().contains("PEGGED"));
        assert!(e["url"]
            .as_str()
            .unwrap()
            .ends_with("/audit/11111111-1111-1111-1111-111111111111"));
    }

    #[test]
    fn discord_color_tracks_severity() {
        let color = |to: &str| {
            let mut c = alert_canonical();
            c["to_state"] = json!(to);
            render_for_channel(ChannelType::Discord, &c).body["embeds"][0]["color"]
                .as_u64()
                .unwrap()
        };
        assert_eq!(color("DEPEG"), 15025741);
        assert_eq!(color("BLACK_SWAN"), 15025741);
        assert_eq!(color("DRIFT"), 16098083);
        assert_eq!(color("PEGGED"), 3187820);
    }

    #[test]
    fn slack_alert_has_attachment_and_is_unsigned() {
        let r = render_for_channel(ChannelType::Slack, &alert_canonical());
        assert!(!r.sign);
        let att = r
            .body
            .get("attachments")
            .and_then(|v| v.as_array())
            .expect("attachments");
        assert_eq!(att.len(), 1);
        assert_eq!(att[0]["title"], "jitoSOL · DRIFT");
        assert_eq!(att[0]["color"], "#F5A623");
    }

    #[test]
    fn retraction_and_evidence_render_for_discord() {
        let retraction = json!({
            "type": "retraction",
            "alert_id": "22222222-2222-2222-2222-222222222222",
            "original_alert_id": "22222222-2222-2222-2222-222222222222",
            "retraction_reason": "methodology bug",
            "retraction_evidence_url": "https://pegana.xyz/audit/22222222-2222-2222-2222-222222222222"
        });
        let r = render_for_channel(ChannelType::Discord, &retraction);
        assert!(r.body["embeds"][0]["title"]
            .as_str()
            .unwrap()
            .contains("retract"));

        let evidence = json!({
            "type": "evidence_now_available",
            "alert_id": "33333333-3333-3333-3333-333333333333",
            "evidence_url": "https://pegana.xyz/audit/33333333-3333-3333-3333-333333333333",
            "evidence_status": "ready"
        });
        let r = render_for_channel(ChannelType::Discord, &evidence);
        assert!(r.body["embeds"][0]["title"]
            .as_str()
            .unwrap()
            .to_lowercase()
            .contains("evidence"));
    }

    #[test]
    fn discord_truncates_pathological_fields() {
        let mut c = alert_canonical();
        c["retraction_reason"] = json!("x".repeat(5000));
        c["type"] = json!("retraction");
        let r = render_for_channel(ChannelType::Discord, &c);
        let desc = r.body["embeds"][0]["description"].as_str().unwrap();
        assert!(
            desc.chars().count() <= 4096,
            "description must respect Discord's 4096 limit"
        );
    }

    #[test]
    fn sign_flag_is_generic_only() {
        let c = alert_canonical();
        assert!(render_for_channel(ChannelType::Generic, &c).sign);
        assert!(!render_for_channel(ChannelType::Discord, &c).sign);
        assert!(!render_for_channel(ChannelType::Slack, &c).sign);
    }
}
