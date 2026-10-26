//! Receiver-response handling helpers for outbound webhook dispatch.
//!
//! Why this module exists: a misbehaving subscriber that returns a
//! 500 with a 100 MB HTML body would let us OOM ourselves the moment
//! we call `reqwest::Response::text().await`. `read_truncated_body`
//! caps the read at `MAX_ERROR_BODY_BYTES` so the cost of a hostile
//! receiver is bounded regardless of `Content-Length`.
//!
//! The cap also bounds `webhook_deliveries.error` row size — the
//! migration documents an 8 KiB intent and this is where it's enforced.

use bytes::Bytes;

/// Hard cap on how much of a non-2xx receiver response we record.
/// 8 KiB is generous enough for realistic error JSON bodies and a
/// short HTML snippet, while keeping a hostile receiver from bloating
/// pg or chewing dispatcher RAM during a sustained outage.
pub const MAX_ERROR_BODY_BYTES: usize = 8 * 1024;

/// Read a response body and return at most `MAX_ERROR_BODY_BYTES` as a
/// lossy UTF-8 string. The reqwest `Response::bytes()` future itself
/// buffers the whole body in memory, but in practice we stop reading
/// the moment we hit the cap by streaming chunks.
///
/// Returns the empty string on any I/O error — the caller wraps the
/// surrounding context (`"http <status>: <body>"`) so an empty body is
/// recognisable.
pub async fn read_truncated_body(res: reqwest::Response) -> String {
    let mut out: Vec<u8> = Vec::with_capacity(1024);
    let mut stream = res.bytes_stream();
    use futures::StreamExt;
    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(Bytes { .. }) if out.len() >= MAX_ERROR_BODY_BYTES => break,
            Ok(b) => {
                let remaining = MAX_ERROR_BODY_BYTES.saturating_sub(out.len());
                if remaining == 0 {
                    break;
                }
                let take = remaining.min(b.len());
                out.extend_from_slice(&b[..take]);
                if take < b.len() {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{response::IntoResponse, routing::get, Router};
    use tokio::net::TcpListener;

    async fn serve_body(body: Vec<u8>) -> String {
        let app =
            Router::new().route(
                "/",
                get(move || {
                    let body = body.clone();
                    async move {
                        ([(axum::http::header::CONTENT_TYPE, "text/plain")], body).into_response()
                    }
                }),
            );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        let url = format!("http://{addr}/");
        let res = reqwest::get(&url).await.unwrap();
        read_truncated_body(res).await
    }

    #[tokio::test]
    async fn small_body_returned_in_full() {
        let s = serve_body(b"oops".to_vec()).await;
        assert_eq!(s, "oops");
    }

    #[tokio::test]
    async fn body_over_cap_truncated_to_cap() {
        let huge = vec![b'A'; MAX_ERROR_BODY_BYTES * 4];
        let s = serve_body(huge).await;
        assert_eq!(s.len(), MAX_ERROR_BODY_BYTES);
        assert!(s.chars().all(|c| c == 'A'));
    }

    #[tokio::test]
    async fn body_exactly_at_cap_returned_in_full() {
        let exact = vec![b'B'; MAX_ERROR_BODY_BYTES];
        let s = serve_body(exact).await;
        assert_eq!(s.len(), MAX_ERROR_BODY_BYTES);
    }
}
