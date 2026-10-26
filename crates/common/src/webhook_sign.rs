//! Shared Ed25519 signing primitive for outbound webhooks.
//!
//! `dispatcher-rs` signs payloads in the canonical forms: v1
//! `<unix-timestamp>.<json-body>` and v2
//! `pegana-webhook-v2.<unix-timestamp>.<event-id>.<json-body>`. Keeping
//! this in one place keeps verification and signing consistent through key
//! rotation. The API publishes only public keys.
//!
//! ## Rotation model (Sprint 1c)
//!
//! Two env vars control the active keyset:
//!
//!   - `PEGANA_WEBHOOK_SIGNING_KEY` — REQUIRED. The **primary** key,
//!     used for ALL outbound signatures.
//!   - `PEGANA_WEBHOOK_SIGNING_KEY_NEXT` — OPTIONAL. The **secondary**
//!     key. Its public half is published alongside the primary on
//!     `GET /v1/meta/webhook-keys` so receivers can start trusting it
//!     BEFORE a rotation.
//!
//! Rotation playbook:
//!
//!   1. Generate a new 32-byte seed → set `PEGANA_WEBHOOK_SIGNING_KEY_NEXT`,
//!      redeploy. Receivers fetching `/v1/meta/webhook-keys` now see
//!      `[primary_pub, secondary_pub]` and update their trust list.
//!   2. Wait at least one receiver poll interval (recommend 24h).
//!   3. Promote: copy the secondary value into `PEGANA_WEBHOOK_SIGNING_KEY`,
//!      unset `PEGANA_WEBHOOK_SIGNING_KEY_NEXT`, redeploy. Old key is
//!      now retired. Receivers that already trust the new pubkey see no
//!      interruption.
//!
//! The verifier helper here (`verify_payload_any`) tries every supplied
//! public key — receivers in `docs/examples/webhook-receivers/` use the
//! same pattern so a single signed delivery validates under any active
//! pubkey.

use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
pub use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use zeroize::Zeroizing;

/// Active signing keyset built from environment. Primary is always
/// present (loader fails otherwise); secondary is `Some` only during a
/// rotation window.
#[derive(Clone)]
pub struct SigningKeys {
    pub primary: SigningKey,
    pub secondary: Option<SigningKey>,
}

impl SigningKeys {
    /// Load the active keyset from environment. Fail-fast on missing or
    /// malformed primary — a misconfigured signer that silently
    /// degrades would break every outbound webhook with no signal.
    pub fn from_env() -> Result<Self> {
        let primary = load_key_env("PEGANA_WEBHOOK_SIGNING_KEY")?
            .context("PEGANA_WEBHOOK_SIGNING_KEY not set")?;
        let secondary = load_key_env("PEGANA_WEBHOOK_SIGNING_KEY_NEXT")?;
        Ok(Self { primary, secondary })
    }

    /// Like [`from_env`], but a MISSING/empty primary yields `Ok(None)` instead
    /// of an error — a malformed key still fails. For services (the dispatcher)
    /// whose PRIMARY job (Telegram alerts, unsigned chat webhooks) does not need
    /// a signing key: they must start and deliver even before the first webhook
    /// subscriber exists (the documented docker-compose contract). Only *signed*
    /// machine webhooks require the key; the caller degrades those gracefully
    /// when this is `None` rather than crash-looping the whole alert pipeline.
    pub fn from_env_optional() -> Result<Option<Self>> {
        let Some(primary) = load_key_env("PEGANA_WEBHOOK_SIGNING_KEY")? else {
            return Ok(None);
        };
        let secondary = load_key_env("PEGANA_WEBHOOK_SIGNING_KEY_NEXT")?;
        Ok(Some(Self { primary, secondary }))
    }

    /// Base64-encoded public keys, primary first. Order matters:
    /// `/v1/meta/webhook-keys` returns this slice as-is, and receivers
    /// should treat index 0 as "current" for any operator-facing UI.
    pub fn pubkeys_b64(&self) -> Vec<String> {
        let mut out = vec![B64.encode(self.primary.verifying_key().to_bytes())];
        if let Some(s) = &self.secondary {
            out.push(B64.encode(s.verifying_key().to_bytes()));
        }
        out
    }
}

/// Public key material supplied to the API without exposing signing seeds.
/// Invalid entries fail closed so a key rotation cannot silently publish an
/// incomplete trust list.
pub fn public_keys_b64_from_env() -> Result<Vec<String>> {
    let raw = std::env::var("PEGANA_WEBHOOK_PUBKEYS_B64").unwrap_or_default();
    parse_public_keys_b64(&raw)
}

fn parse_public_keys_b64(raw: &str) -> Result<Vec<String>> {
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    raw.split(',')
        .map(|entry| {
            let bytes = B64
                .decode(entry.trim())
                .context("PEGANA_WEBHOOK_PUBKEYS_B64 must contain base64 public keys")?;
            let arr: [u8; 32] = bytes
                .try_into()
                .map_err(|_| anyhow::anyhow!("webhook public key must be 32 bytes"))?;
            let key = VerifyingKey::from_bytes(&arr).context("invalid webhook public key")?;
            Ok(B64.encode(key.to_bytes()))
        })
        .collect()
}

fn load_key_env(env_name: &str) -> Result<Option<SigningKey>> {
    let raw = match std::env::var(env_name) {
        Ok(v) if !v.trim().is_empty() => Zeroizing::new(v),
        _ => return Ok(None),
    };
    // Seed intermediates are wiped on drop so no copy of the key lingers in
    // freed heap or stack memory.
    let bytes = Zeroizing::new(
        B64.decode(raw.trim())
            .with_context(|| format!("{env_name} must be base64"))?,
    );
    anyhow::ensure!(
        bytes.len() == 32,
        "{env_name} must decode to 32 bytes (got {})",
        bytes.len()
    );
    let mut arr = Zeroizing::new([0u8; 32]);
    arr.copy_from_slice(&bytes);
    Ok(Some(SigningKey::from_bytes(&arr)))
}

/// Canonical sign of `<ts>.<body>` returning standard base64 (NOT
/// URL-safe — the receiver examples decode with the standard alphabet).
pub fn sign_payload(key: &SigningKey, ts: &str, body: &str) -> String {
    let input = format!("{}.{}", ts, body);
    let sig: Signature = key.sign(input.as_bytes());
    B64.encode(sig.to_bytes())
}

/// Domain-separation prefix of the v2 signed message.
pub const V2_DOMAIN: &str = "pegana-webhook-v2";

/// v2 signed message: `pegana-webhook-v2.<ts>.<event-id>.<body>`.
fn v2_signing_input(ts: &str, event_id: &str, body: &str) -> String {
    format!("{V2_DOMAIN}.{ts}.{event_id}.{body}")
}

/// V2 signature binds the stable event id header to the exact JSON body.
pub fn sign_payload_v2(key: &SigningKey, ts: &str, event_id: &str, body: &str) -> String {
    let input = v2_signing_input(ts, event_id, body);
    let sig: Signature = key.sign(input.as_bytes());
    B64.encode(sig.to_bytes())
}

/// Verify a v2 signature against any currently trusted public key.
pub fn verify_payload_v2_any(
    pubkeys: &[VerifyingKey],
    ts: &str,
    event_id: &str,
    body: &str,
    sig_b64: &str,
) -> bool {
    let input = v2_signing_input(ts, event_id, body);
    verify_input_any(pubkeys, &input, sig_b64)
}

/// Verify a base64 signature against ANY of the supplied public keys.
/// Returns `true` if at least one verifies. Receivers should pass both
/// pubkeys from `/v1/meta/webhook-keys` here so deliveries signed by
/// either active key validate seamlessly across rotation.
///
/// Never panics — every decode error / length mismatch / verification
/// failure surfaces as `false`.
pub fn verify_payload_any(pubkeys: &[VerifyingKey], ts: &str, body: &str, sig_b64: &str) -> bool {
    let input = format!("{}.{}", ts, body);
    verify_input_any(pubkeys, &input, sig_b64)
}

fn verify_input_any(pubkeys: &[VerifyingKey], input: &str, sig_b64: &str) -> bool {
    let Ok(sig_bytes) = B64.decode(sig_b64) else {
        return false;
    };
    if sig_bytes.len() != 64 {
        return false;
    }
    let mut sig_arr = [0u8; 64];
    sig_arr.copy_from_slice(&sig_bytes);
    let sig = Signature::from_bytes(&sig_arr);
    pubkeys
        .iter()
        .any(|pk| pk.verify_strict(input.as_bytes(), &sig).is_ok())
}

/// Single-key verifier — convenience for the dispatcher-rs unit tests
/// that pre-date the dual-active model. New call sites should prefer
/// `verify_payload_any` so they pick up rotation for free.
pub fn verify_payload(public: &VerifyingKey, ts: &str, body: &str, sig_b64: &str) -> bool {
    verify_payload_any(std::slice::from_ref(public), ts, body, sig_b64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;
    use rand::rngs::OsRng;

    fn fresh_key() -> SigningKey {
        SigningKey::generate(&mut OsRng)
    }

    fn golden_key() -> SigningKey {
        let mut seed = [0u8; 32];
        for (i, b) in seed.iter_mut().enumerate() {
            *b = i as u8;
        }
        SigningKey::from_bytes(&seed)
    }

    const GOLDEN_TS: &str = "1700000000";
    const GOLDEN_ID: &str = "00000000-0000-4000-8000-000000000001";
    const GOLDEN_BODY: &str = r#"{"alert_id":"00000000-0000-4000-8000-000000000001","asset":"jitoSOL","to_state":"DEPEG"}"#;
    const GOLDEN_PUBKEY: &str = "A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=";
    const GOLDEN_V1: &str =
        "Gpu1U4olo6STeYr27K6qYvWl90VawFLzkF8vUNZzWCIuKmFwtHS3lNNWNbbHmQY3wM6Rupj1M1GFFaqSMpEiDw==";
    const GOLDEN_V2: &str =
        "EAiQCh9Cbfqho1Z8TV6s2TyyY9gMslfn756wqO5bVwOJl62yztsBBmMNJiVONK5PfUwkw+36XaYkPd7o+IsNBw==";

    #[test]
    fn v2_golden_vector() {
        let k = golden_key();
        let pk = B64.encode(k.verifying_key().to_bytes());
        let v1 = sign_payload(&k, GOLDEN_TS, GOLDEN_BODY);
        let v2 = sign_payload_v2(&k, GOLDEN_TS, GOLDEN_ID, GOLDEN_BODY);
        assert_eq!(pk, GOLDEN_PUBKEY);
        assert_eq!(v1, GOLDEN_V1);
        assert_eq!(v2, GOLDEN_V2);

        let keys = [k.verifying_key()];
        assert!(verify_payload_any(&keys, GOLDEN_TS, GOLDEN_BODY, &v1));
        assert!(verify_payload_v2_any(
            &keys,
            GOLDEN_TS,
            GOLDEN_ID,
            GOLDEN_BODY,
            &v2
        ));

        // v1 and v2 signatures are not interchangeable.
        assert!(!verify_payload_v2_any(
            &keys,
            GOLDEN_TS,
            GOLDEN_ID,
            GOLDEN_BODY,
            &v1
        ));
        assert!(!verify_payload_any(&keys, GOLDEN_TS, GOLDEN_BODY, &v2));

        // Tamper cases: ts, id, body, signature bytes.
        assert!(!verify_payload_v2_any(
            &keys,
            "1700000001",
            GOLDEN_ID,
            GOLDEN_BODY,
            &v2
        ));
        assert!(!verify_payload_v2_any(
            &keys,
            GOLDEN_TS,
            "00000000-0000-4000-8000-000000000002",
            GOLDEN_BODY,
            &v2
        ));
        let tampered_body = GOLDEN_BODY.replace("DEPEG", "DRIFT");
        assert!(!verify_payload_v2_any(
            &keys,
            GOLDEN_TS,
            GOLDEN_ID,
            &tampered_body,
            &v2
        ));
        let mut raw = B64.decode(&v2).unwrap();
        raw[0] ^= 1;
        assert!(!verify_payload_v2_any(
            &keys,
            GOLDEN_TS,
            GOLDEN_ID,
            GOLDEN_BODY,
            &B64.encode(raw)
        ));
    }

    #[test]
    fn roundtrip_sign_verify() {
        let k = fresh_key();
        let sig = sign_payload(&k, "1700000000", r#"{"asset":"USDC"}"#);
        assert!(verify_payload(
            &k.verifying_key(),
            "1700000000",
            r#"{"asset":"USDC"}"#,
            &sig
        ));
    }

    #[test]
    fn dual_pubkey_verifies_either_signer() {
        let primary = fresh_key();
        let secondary = fresh_key();
        let ts = "1700000001";
        let body = r#"{"asset":"jitoSOL"}"#;
        let sig_p = sign_payload(&primary, ts, body);
        let sig_s = sign_payload(&secondary, ts, body);
        let trusted = [primary.verifying_key(), secondary.verifying_key()];

        // Either key's signature verifies under the combined trust set.
        assert!(verify_payload_any(&trusted, ts, body, &sig_p));
        assert!(verify_payload_any(&trusted, ts, body, &sig_s));

        // A third unrelated key does NOT.
        let stranger = fresh_key();
        let sig_x = sign_payload(&stranger, ts, body);
        assert!(!verify_payload_any(&trusted, ts, body, &sig_x));
    }

    #[test]
    fn malformed_signature_returns_false_not_panic() {
        let k = fresh_key();
        assert!(!verify_payload(
            &k.verifying_key(),
            "1700000000",
            "body",
            "!!! not base64 !!!"
        ));
        // Right base64, wrong length.
        assert!(!verify_payload(
            &k.verifying_key(),
            "1700000000",
            "body",
            &B64.encode([0u8; 10])
        ));
    }

    #[test]
    fn tampered_body_fails_verification() {
        let k = fresh_key();
        let sig = sign_payload(&k, "1700000000", r#"{"discount_bps":-47}"#);
        assert!(!verify_payload(
            &k.verifying_key(),
            "1700000000",
            r#"{"discount_bps":-470}"#, // attacker shifted decimal
            &sig
        ));
    }

    #[test]
    fn tampered_timestamp_fails_verification() {
        let k = fresh_key();
        let sig = sign_payload(&k, "1700000000", "body");
        assert!(!verify_payload(
            &k.verifying_key(),
            "1700000001", // replay window shifted
            "body",
            &sig
        ));
    }

    #[test]
    fn v2_binds_event_id_and_keeps_v1_compatible() {
        let key = fresh_key();
        let event_id = "00000000-0000-0000-0000-000000000001";
        let body = r#"{"alert_id":"00000000-0000-0000-0000-000000000001"}"#;
        let v1 = sign_payload(&key, "1700000000", body);
        let v2 = sign_payload_v2(&key, "1700000000", event_id, body);
        let trusted = [key.verifying_key()];
        assert!(verify_payload_any(&trusted, "1700000000", body, &v1));
        assert!(verify_payload_v2_any(
            &trusted,
            "1700000000",
            event_id,
            body,
            &v2
        ));
        assert!(!verify_payload_v2_any(
            &trusted,
            "1700000000",
            "00000000-0000-0000-0000-000000000002",
            body,
            &v2
        ));
        assert!(!verify_payload_v2_any(
            &trusted,
            "1700000000",
            event_id,
            "{}",
            &v2
        ));
    }

    #[test]
    fn public_key_list_validates_every_entry() {
        let first = fresh_key().verifying_key();
        let second = fresh_key().verifying_key();
        let encoded = format!(
            "{}, {}",
            B64.encode(first.to_bytes()),
            B64.encode(second.to_bytes())
        );
        assert_eq!(parse_public_keys_b64(&encoded).unwrap().len(), 2);
        assert!(parse_public_keys_b64(&format!("{encoded}, bad")).is_err());
        assert!(parse_public_keys_b64(&B64.encode([0u8; 10])).is_err());
    }
}
