//! Roundtrip + tampered-body coverage for the Ed25519 signing helper.
//!
//! These tests don't touch Redis / Postgres / HTTP — pure crypto, so
//! they run on every `cargo test -p dispatcher-rs` invocation.

use dispatcher_rs::webhook::{sign_payload, verify_payload, SigningKey};

#[test]
fn sign_then_verify_roundtrip() {
    let key = SigningKey::generate(&mut rand::thread_rng());
    let ts = "1779827802";
    let body = r#"{"asset":"sUSDe","from_state":"PEGGED","to_state":"DRIFT"}"#;
    let sig = sign_payload(&key, ts, body);
    assert!(verify_payload(&key.verifying_key(), ts, body, &sig));
}

#[test]
fn tampered_body_rejected() {
    let key = SigningKey::generate(&mut rand::thread_rng());
    let ts = "1779827802";
    let body = r#"{"asset":"sUSDe"}"#;
    let sig = sign_payload(&key, ts, body);
    let tampered = r#"{"asset":"sUSDx"}"#;
    assert!(!verify_payload(&key.verifying_key(), ts, tampered, &sig));
}

#[test]
fn tampered_timestamp_rejected() {
    let key = SigningKey::generate(&mut rand::thread_rng());
    let body = r#"{"asset":"jitoSOL"}"#;
    let sig = sign_payload(&key, "1779827802", body);
    assert!(!verify_payload(
        &key.verifying_key(),
        "1779827803",
        body,
        &sig
    ));
}

#[test]
fn bad_signature_rejected() {
    let key = SigningKey::generate(&mut rand::thread_rng());
    let ts = "1779827802";
    let body = r#"{"x":1}"#;
    assert!(!verify_payload(
        &key.verifying_key(),
        ts,
        body,
        "not-base64-AAAA"
    ));
    assert!(!verify_payload(&key.verifying_key(), ts, body, "AAAA")); // too short
}

/// Wave 5A — both `evidence_url` (Phase 5 spec) and `evidence_status`
/// (ADR-0006) are part of the signed body. Stripping EITHER field at a
/// receiver MUST invalidate the signature so downstream pipelines can
/// trust the link AND its lifecycle state without a second round-trip.
#[test]
fn evidence_url_and_status_fields_are_part_of_signed_body() {
    let key = SigningKey::generate(&mut rand::thread_rng());
    let ts = "1779827802";
    // Body shape matching what main.rs::webhook_fanout emits post-Wave 5A.
    let body = r#"{"asset":"USDe","from_state":"PEGGED","to_state":"DRIFT","discount_bps":150,"ts":"2026-06-11T12:00:00Z","alert_id":"00000000-0000-0000-0000-000000000001","evidence_url":"https://pegana.xyz/audit/00000000-0000-0000-0000-000000000001","evidence_status":"pending"}"#;
    let sig = sign_payload(&key, ts, body);
    assert!(verify_payload(&key.verifying_key(), ts, body, &sig));

    // Stripping evidence_url breaks the signature.
    let no_url = r#"{"asset":"USDe","from_state":"PEGGED","to_state":"DRIFT","discount_bps":150,"ts":"2026-06-11T12:00:00Z","alert_id":"00000000-0000-0000-0000-000000000001","evidence_status":"pending"}"#;
    assert!(!verify_payload(&key.verifying_key(), ts, no_url, &sig));

    // Stripping evidence_status breaks the signature.
    let no_status = r#"{"asset":"USDe","from_state":"PEGGED","to_state":"DRIFT","discount_bps":150,"ts":"2026-06-11T12:00:00Z","alert_id":"00000000-0000-0000-0000-000000000001","evidence_url":"https://pegana.xyz/audit/00000000-0000-0000-0000-000000000001"}"#;
    assert!(!verify_payload(&key.verifying_key(), ts, no_status, &sig));
}
