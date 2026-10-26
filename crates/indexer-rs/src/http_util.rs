//! Bounded reads of upstream HTTP bodies.

use anyhow::{bail, Context, Result};
use serde::de::DeserializeOwned;

/// Default cap for upstream JSON bodies (quotes, NAV lists, pair lists).
pub const MAX_UPSTREAM_BODY_BYTES: usize = 4 * 1024 * 1024;

/// Append `chunk` to `body`, refusing to grow past `max` bytes.
fn push_capped(body: &mut Vec<u8>, chunk: &[u8], max: usize) -> Result<()> {
    if body.len().saturating_add(chunk.len()) > max {
        bail!("upstream body exceeds {max} bytes");
    }
    body.extend_from_slice(chunk);
    Ok(())
}

/// Read and parse a JSON response without ever buffering more than `max` bytes.
pub async fn json_capped<T: DeserializeOwned>(
    mut resp: reqwest::Response,
    max: usize,
) -> Result<T> {
    if resp.content_length().is_some_and(|len| len > max as u64) {
        bail!("upstream body exceeds {max} bytes");
    }
    let mut body = Vec::new();
    while let Some(chunk) = resp.chunk().await.context("read upstream body")? {
        push_capped(&mut body, &chunk, max)?;
    }
    serde_json::from_slice(&body).context("parse upstream JSON")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn body_growth_is_capped() {
        let mut body = Vec::new();
        push_capped(&mut body, &[0; 6], 10).unwrap();
        push_capped(&mut body, &[0; 4], 10).unwrap();
        assert!(push_capped(&mut body, &[0; 1], 10).is_err());
        assert_eq!(body.len(), 10);
    }
}
