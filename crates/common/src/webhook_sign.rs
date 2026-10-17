//! Shared Ed25519 signing primitive for outbound webhooks.
//!
//! Both `dispatcher-rs` (production fan-out, retried) and `api-rs`
//! (`/test` and `/replay` single-shot deliveries) sign payloads in the
//! exact same canonical form: `<unix-timestamp>.<json-body>`. Keeping
//! this in one place is the only way the dual-active rotation semantics
//! stay consistent — if dispatcher signs with key A but api-rs signs
//! with key B, receivers verifying against a single trusted pubkey see
//! intermittent failures.
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

/// Active signing keyset built from environment. Primary is always
/// present (loader fails otherwise); secondary is `Some` only during a
/// rotation window.
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

fn load_key_env(env_name: &str) -> Result<Option<SigningKey>> {
    let raw = match std::env::var(env_name) {
        Ok(v) if !v.trim().is_empty() => v,
        _ => return Ok(None),
    };
    let bytes = B64
        .decode(raw.trim())
        .with_context(|| format!("{env_name} must be base64"))?;
    anyhow::ensure!(
        bytes.len() == 32,
        "{env_name} must decode to 32 bytes (got {})",
        bytes.len()
    );
    let mut arr = [0u8; 32];
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

/// Verify a base64 signature against ANY of the supplied public keys.
/// Returns `true` if at least one verifies. Receivers should pass both
/// pubkeys from `/v1/meta/webhook-keys` here so deliveries signed by
/// either active key validate seamlessly across rotation.
///
/// Never panics — every decode error / length mismatch / verification
/// failure surfaces as `false`.
pub fn verify_payload_any(pubkeys: &[VerifyingKey], ts: &str, body: &str, sig_b64: &str) -> bool {
    let Ok(sig_bytes) = B64.decode(sig_b64) else {
        return false;
    };
    if sig_bytes.len() != 64 {
        return false;
    }
    let mut sig_arr = [0u8; 64];
    sig_arr.copy_from_slice(&sig_bytes);
    let sig = Signature::from_bytes(&sig_arr);
    let input = format!("{}.{}", ts, body);
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
}
