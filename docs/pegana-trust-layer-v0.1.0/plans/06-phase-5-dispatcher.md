> ⚠️ **AMENDED** — see [`../AMENDMENTS.md`](../AMENDMENTS.md) for the ADR index that may override decisions in this document.
> Original plan preserved below as historical reference.

---

# Phase 5 — Dispatcher: evidence_url Propagation

**Spec reference**: `../08-external-surfaces.md § Dispatcher`
**Acceptance criteria covered**: AC27 (webhook), AC26 (bot — depends on Phase 6 locale too)
**Dependencies**: Phase 4 (URL pattern decided)
**Estimated duration**: 0.5 day

---

## Overview

Two small changes:
1. `format.rs::build_send_payload` adds `evidenceUrl` + `alertId` to bot `/send` `vars` (Fluent receives these and renders the link in templates — Phase 6 adds the template strings).
2. `webhook.rs` payload gets a top-level `evidence_url` field (HMAC ed25519 signing automatically covers it).

---

## Task 5.1 — Bot /send payload includes evidenceUrl + alertId

**Files**:
- Modify: `crates/dispatcher-rs/src/format.rs`
- Modify: `crates/dispatcher-rs/src/main.rs` (or wherever DispatchConfig is built — load AUDIT_BASE_URL)
- Modify: `crates/dispatcher-rs/src/webhook.rs::DispatchConfig` (add `audit_base_url: String`)

- [ ] **Step 1**: Update `DispatchConfig` to carry audit base URL

In `crates/dispatcher-rs/src/webhook.rs` (where `DispatchConfig` is defined), add field:

```rust
pub struct DispatchConfig {
    // ... existing fields ...
    pub audit_base_url: String,
}
```

- [ ] **Step 2**: Load `AUDIT_BASE_URL` at startup

In `crates/dispatcher-rs/src/main.rs`, where `DispatchConfig` is constructed, add:

```rust
let audit_base_url = pegana_common::audit_base_url();  // defaults to "https://pegana.xyz"
let config = DispatchConfig {
    // ... existing fields ...
    audit_base_url,
};
```

- [ ] **Step 3**: Update `build_send_payload` signature

In `crates/dispatcher-rs/src/format.rs`, replace function signature:

```rust
pub fn build_send_payload(
    chat_id: i64,
    locale: &str,
    event: &AlertEvent,
    audit_base_url: &str,    // NEW
) -> Value {
    let template = match event.class {
        AssetClass::Lst => "alert_lst",
        AssetClass::StableCdp => "alert_cdp",
        AssetClass::StableFx => "alert_fx",
        AssetClass::StableYield => "alert_yield",
        _ => "alert_stable",
    };

    json!({
        "chatId": chat_id,
        "template": template,
        "locale": locale,
        "idempotencyKey": format!("alert:{}", event.id),
        "vars": {
            "asset": event.asset,
            "class": class_label(event.class),
            "fromState": label(event.from_state),
            "toState": label(event.to_state),
            "discount": event.discount,
            "intrinsicUsd": event.intrinsic_usd,
            "marketUsd": event.market_usd,
            "extra": event.extra,
            "detectedAt": event.detected_at,
            "alertId": event.id,                                              // NEW
            "evidenceUrl": format!("{}/audit/{}", audit_base_url, event.id),  // NEW
        }
    })
}
```

- [ ] **Step 4**: Update all call sites

Search for `build_send_payload` calls in `crates/dispatcher-rs/src/`:

```bash
grep -rn "build_send_payload" crates/dispatcher-rs/src/
```

For each, add `&config.audit_base_url` as the 4th argument.

- [ ] **Step 5**: Update tests if any reference `build_send_payload`

```bash
grep -rn "build_send_payload" crates/dispatcher-rs/tests/
```

For each test fixture, pass `"https://pegana.test"` as the new argument.

- [ ] **Step 6**: Run dispatcher tests

```bash
cargo test -p dispatcher-rs
```

Expected: all tests pass with new signature.

- [ ] **Step 7**: Commit

```bash
git add crates/dispatcher-rs/
git commit -m "$(cat <<'EOF'
feat(dispatcher): thread evidenceUrl + alertId into bot /send payload

DispatchConfig now carries audit_base_url (loaded from env). format::build_send_payload
appends evidenceUrl and alertId to the vars object. Bot's /send endpoint
(Zod schema accepts arbitrary vars) passes them through to Fluent
templates — actual template strings added in Phase 6.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5.2 — Webhook payload includes evidence_url

**Files**:
- Modify: `crates/dispatcher-rs/src/main.rs` (NOT webhook.rs — payload built in main.rs around line 469)
- Modify: `crates/dispatcher-rs/tests/webhook_signing.rs` (add new test)

- [ ] **Step 1**: Locate webhook payload assembly (it's in main.rs, NOT webhook.rs)

Per the actual code (`crates/dispatcher-rs/src/main.rs` ~line 469), the webhook body is built inside `tokio::spawn` per subscription:

```rust
let payload = serde_json::json!({
    "asset": evt.asset,
    "from_state": evt.from_state,
    "to_state": evt.to_state,
    "discount_bps": (decimal_to_f64(evt.discount) * 10_000.0) as i64,
    "ts": evt.detected_at,
    "alert_id": evt.id,
});
```

`webhook.rs::dispatch_one` receives this as `payload: &Value` argument and signs it via HMAC ed25519. We modify the CONSTRUCTION SITE (main.rs), not webhook.rs.

Modify the json! macro:

```rust
let payload = serde_json::json!({
    "asset": evt.asset,
    "from_state": evt.from_state,
    "to_state": evt.to_state,
    "discount_bps": (decimal_to_f64(evt.discount) * 10_000.0) as i64,
    "ts": evt.detected_at,
    "alert_id": evt.id,
    "evidence_url": format!("{}/audit/{}", dispatch_cfg.audit_base_url, evt.id),  // NEW
});
```

`dispatch_cfg` is the `DispatchConfig` in scope (it was cloned for the per-subscription spawn). Signing in `dispatch_one` automatically covers the full body string including the new field.

- [ ] **Step 2**: Add new pure-crypto test verifying signed body includes evidence_url

The existing `tests/webhook_signing.rs` is pure crypto (no HTTP, no DB). Add following the same pattern:

```rust
#[test]
fn evidence_url_field_is_part_of_signed_body() {
    let key = SigningKey::generate(&mut rand::thread_rng());
    let ts = "1779827802";
    // Body shape matching what main.rs:469 will emit post-Phase 5:
    let body = r#"{"asset":"USDe","from_state":"PEGGED","to_state":"DRIFT","discount_bps":150,"ts":"2026-06-11T12:00:00Z","alert_id":"00000000-0000-0000-0000-000000000001","evidence_url":"https://pegana.xyz/audit/00000000-0000-0000-0000-000000000001"}"#;
    let sig = sign_payload(&key, ts, body);
    // Signature verifies on the EXACT body that includes evidence_url
    assert!(verify_payload(&key.verifying_key(), ts, body, &sig));

    // If a receiver strips evidence_url, signature MUST NOT verify
    let stripped = r#"{"asset":"USDe","from_state":"PEGGED","to_state":"DRIFT","discount_bps":150,"ts":"2026-06-11T12:00:00Z","alert_id":"00000000-0000-0000-0000-000000000001"}"#;
    assert!(!verify_payload(&key.verifying_key(), ts, stripped, &sig));
}
```

Uses existing imports at top of `webhook_signing.rs`: `dispatcher_rs::webhook::{sign_payload, verify_payload, SigningKey}`.

- [ ] **Step 3**: Run

```bash
cargo test -p dispatcher-rs --test webhook_signing
```

Expected: pass.

- [ ] **Step 4**: Commit

```bash
git add crates/dispatcher-rs/
git commit -m "$(cat <<'EOF'
feat(dispatcher): webhook payload includes signed evidence_url

Additive change — existing HMAC ed25519 signing covers the new field.
Existing webhook consumers ignore unknown JSON fields. Test extended
to verify evidence_url presence + signature validity.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Acceptance verification for Phase 5

- [ ] AC27 — Webhook payload includes `evidence_url`; HMAC signature covers the new field (`crates/dispatcher-rs/tests/webhook_signing.rs` confirms)
- [ ] Bot integration verified end-to-end in Phase 6 + dispatcher integration test (send → bot mock → render)

---

## Cross-references

- For Phase 6 bot locale additions consuming `evidenceUrl`, see `07-phase-6-7-bot-mcp.md`.
- For external surfaces spec, see `../08-external-surfaces.md`.
- For Phase 12 trust strip on home (separate use of stats), see `12-phase-12-observability.md`.
