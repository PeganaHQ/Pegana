//! SSRF guard for user-supplied webhook URLs.
//!
//! Used by:
//!   - dispatcher-rs/src/webhook.rs at dispatch time (async, resolves DNS and
//!     re-checks against the unsafe ranges)
//!
//! Defense layers (in order):
//!   1. Parse with `url::Url` — reject anything that isn't a valid absolute URL.
//!   2. Require scheme `https`.
//!   3. Block hard-coded host names that obviously target internal infra:
//!      `localhost`, `*.local`, `*.internal`, `*.localhost`.
//!   4. If host is an IP literal, classify against std's IP predicates.
//!   5. At dispatch time, resolve DNS and refuse if ANY returned A/AAAA is in
//!      an unsafe range (private, loopback, link-local, multicast, broadcast,
//!      documentation, unspecified, IPv6 ULA, IPv4-in-IPv6 mapping that itself
//!      lands in a private range, CGNAT 100.64/10, or known cloud metadata IP
//!      169.254.169.254).
//!
//! Bypass: set `WEBHOOK_SSRF_ALLOW_LOOPBACK=1` to let `dispatch_one` reach
//! loopback addresses. Used only by the local integration tests in
//! `crates/dispatcher-rs/tests/webhook_receivers.rs`.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use thiserror::Error;
use url::{Host, Url};

#[derive(Debug, Error)]
pub enum UrlGuardError {
    #[error("url parse error: {0}")]
    Parse(#[from] url::ParseError),
    #[error("url scheme must be https, got '{0}'")]
    BadScheme(String),
    #[error("url has no host")]
    NoHost,
    #[error("host '{host}' resolves to a non-public address {ip} — refused for SSRF safety")]
    UnsafeIp { host: String, ip: String },
    #[error("host '{0}' is on the static deny list")]
    DenyHost(String),
    #[error("dns resolution for '{host}' failed: {reason}")]
    DnsFailure { host: String, reason: String },
    #[error("dns resolution for '{0}' returned no addresses")]
    NoDnsAddresses(String),
}

const HOST_DENYLIST_EXACT: &[&str] = &["localhost", "ip6-localhost", "ip6-loopback"];

const HOST_DENYLIST_SUFFIX: &[&str] = &[".local", ".internal", ".localhost"];

fn is_unsafe_ipv4(v4: Ipv4Addr) -> bool {
    let o = v4.octets();
    v4.is_loopback()
        || v4.is_private()
        || v4.is_link_local()
        || v4.is_multicast()
        || v4.is_unspecified()
        || v4.is_broadcast()
        || v4.is_documentation()
        // 100.64.0.0/10 — Carrier-grade NAT (RFC 6598)
        || (o[0] == 100 && (64..=127).contains(&o[1]))
        // 192.0.0.0/24 — IETF Protocol Assignments
        || (o[0] == 192 && o[1] == 0 && o[2] == 0)
        // 198.18.0.0/15 — Benchmarking
        || (o[0] == 198 && (o[1] == 18 || o[1] == 19))
        // 240.0.0.0/4 — Reserved
        || o[0] >= 240
}

fn is_unsafe_ipv6(v6: Ipv6Addr) -> bool {
    if v6.is_loopback() || v6.is_unspecified() || v6.is_multicast() {
        return true;
    }
    let seg = v6.segments();
    // fc00::/7 — Unique local addresses (RFC 4193)
    if (seg[0] & 0xfe00) == 0xfc00 {
        return true;
    }
    // fe80::/10 — Link-local
    if (seg[0] & 0xffc0) == 0xfe80 {
        return true;
    }
    // ::ffff:0:0/96 — IPv4-mapped IPv6 → reuse v4 check
    if let Some(mapped) = v6.to_ipv4_mapped() {
        return is_unsafe_ipv4(mapped);
    }
    // Every remaining arm below embeds an IPv4 address inside an IPv6 one. The
    // guard above already handles the ::ffff: form; these three encode the same
    // target differently and slipped straight through, so `https://[64:ff9b::7f00:1]`
    // reached 127.0.0.1 on any host with a NAT64 or 6to4 path. Extract the
    // embedded v4 and re-run the v4 check — same idiom as to_ipv4_mapped above,
    // which keeps legitimate public addresses in these ranges reachable rather
    // than blanket-blocking the prefix.
    //
    // 64:ff9b::/96 — NAT64 (RFC 6052). v4 lives in the last two groups.
    if seg[0] == 0x0064 && seg[1] == 0xff9b && seg[2..6] == [0, 0, 0, 0] {
        return is_unsafe_ipv4(Ipv4Addr::new(
            (seg[6] >> 8) as u8,
            (seg[6] & 0xff) as u8,
            (seg[7] >> 8) as u8,
            (seg[7] & 0xff) as u8,
        ));
    }
    // 2002::/16 — 6to4 (RFC 3056). v4 lives in groups 1-2.
    if seg[0] == 0x2002 {
        return is_unsafe_ipv4(Ipv4Addr::new(
            (seg[1] >> 8) as u8,
            (seg[1] & 0xff) as u8,
            (seg[2] >> 8) as u8,
            (seg[2] & 0xff) as u8,
        ));
    }
    // ::/96 — deprecated IPv4-compatible (RFC 4291 §2.5.5.1). `to_ipv4_mapped`
    // returns None for these, so `::127.0.0.1` was reaching loopback.
    if seg[0..5] == [0, 0, 0, 0, 0] && seg[5] == 0 && (seg[6] != 0 || seg[7] != 0) {
        return is_unsafe_ipv4(Ipv4Addr::new(
            (seg[6] >> 8) as u8,
            (seg[6] & 0xff) as u8,
            (seg[7] >> 8) as u8,
            (seg[7] & 0xff) as u8,
        ));
    }
    // 2001:db8::/32 — documentation range, never a legitimate webhook target.
    if seg[0] == 0x2001 && seg[1] == 0x0db8 {
        return true;
    }
    // 100::/64 — discard-only (RFC 6666).
    if seg[0] == 0x0100 && seg[1..4] == [0, 0, 0] {
        return true;
    }
    false
}

fn is_unsafe_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_unsafe_ipv4(v4),
        IpAddr::V6(v6) => is_unsafe_ipv6(v6),
    }
}

fn host_on_denylist(domain: &str) -> bool {
    let lower = domain.to_ascii_lowercase();
    HOST_DENYLIST_EXACT.iter().any(|d| **d == lower)
        || HOST_DENYLIST_SUFFIX.iter().any(|suf| lower.ends_with(suf))
}

/// Synchronous, fast guard for the registration path. Catches the obvious
/// attacks (https://127.0.0.1, https://10.0.0.1, https://localhost,
/// https://169.254.169.254) without doing DNS. Pair with
/// `validate_url_runtime` at dispatch time for the full defense.
///
/// Test bypass: `WEBHOOK_SSRF_ALLOW_LOOPBACK=1` accepts `http://` and
/// loopback/private hosts so integration tests can spin up local sinks
/// without setting up TLS. Mirror this bypass in `validate_url_runtime`
/// so a test never falls into half-bypass state (scheme allowed, DNS
/// rejected). Production callers MUST NOT set this env.
pub fn validate_url_static(input: &str) -> Result<Url, UrlGuardError> {
    let parsed = Url::parse(input)?;
    let allow_loopback = std::env::var("WEBHOOK_SSRF_ALLOW_LOOPBACK").as_deref() == Ok("1");
    if !allow_loopback && parsed.scheme() != "https" {
        return Err(UrlGuardError::BadScheme(parsed.scheme().into()));
    }
    if allow_loopback {
        return Ok(parsed);
    }
    let host = parsed.host().ok_or(UrlGuardError::NoHost)?;
    match host {
        Host::Domain(d) => {
            if host_on_denylist(d) {
                return Err(UrlGuardError::DenyHost(d.to_ascii_lowercase()));
            }
        }
        Host::Ipv4(v4) => {
            if is_unsafe_ipv4(v4) {
                return Err(UrlGuardError::UnsafeIp {
                    host: v4.to_string(),
                    ip: v4.to_string(),
                });
            }
        }
        Host::Ipv6(v6) => {
            if is_unsafe_ipv6(v6) {
                return Err(UrlGuardError::UnsafeIp {
                    host: v6.to_string(),
                    ip: v6.to_string(),
                });
            }
        }
    }
    Ok(parsed)
}

/// Async dispatch-time guard. Re-runs the static check, then resolves DNS
/// and refuses if ANY returned A/AAAA record is in an unsafe range. Set
/// `WEBHOOK_SSRF_ALLOW_LOOPBACK=1` in the environment to bypass — used by
/// integration tests that point at `https://127.0.0.1:PORT`.
pub async fn validate_url_runtime(url: &Url) -> Result<Vec<SocketAddr>, UrlGuardError> {
    if std::env::var("WEBHOOK_SSRF_ALLOW_LOOPBACK").as_deref() == Ok("1") {
        // Dev/test bypass — return no pin addrs so the caller uses its default
        // (unpinned) client and can reach a local sink.
        return Ok(Vec::new());
    }
    if url.scheme() != "https" {
        return Err(UrlGuardError::BadScheme(url.scheme().into()));
    }
    let host = url.host_str().ok_or(UrlGuardError::NoHost)?;
    let port = url.port_or_known_default().unwrap_or(443);

    // If the URL host is itself an IP literal, skip DNS — the static check
    // already vetted it. Re-check here anyway (defense in depth) and pin the
    // connect to that exact IP.
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_unsafe_ip(ip) {
            return Err(UrlGuardError::UnsafeIp {
                host: host.into(),
                ip: ip.to_string(),
            });
        }
        return Ok(vec![SocketAddr::new(ip, port)]);
    }

    let addrs =
        tokio::net::lookup_host((host, port))
            .await
            .map_err(|e| UrlGuardError::DnsFailure {
                host: host.into(),
                reason: e.to_string(),
            })?;

    // Collect the RESOLVED-AND-VETTED addrs so the caller can PIN the outbound
    // connect to exactly these (closing the DNS-rebinding TOCTOU: the attacker's
    // authoritative DNS cannot rebind `host` to an internal IP between this check
    // and reqwest's own connect-time resolution, because the connect is forced to
    // these addrs via `pinned_webhook_client`).
    let mut safe = Vec::new();
    for sa in addrs {
        if is_unsafe_ip(sa.ip()) {
            return Err(UrlGuardError::UnsafeIp {
                host: host.into(),
                ip: sa.ip().to_string(),
            });
        }
        safe.push(sa);
    }
    if safe.is_empty() {
        return Err(UrlGuardError::NoDnsAddresses(host.into()));
    }
    Ok(safe)
}

/// Build a webhook-egress reqwest client PINNED to `safe_addrs` (the exact addrs
/// [`validate_url_runtime`] just vetted) for `host`, closing the DNS-rebinding
/// TOCTOU: the TCP connect is forced to those IPs, so a rebinding DNS cannot swing
/// it to loopback/metadata between validation and connect. TLS SNI + the `Host`
/// header still use the original hostname. Replicates the shared egress client's
/// config (10s timeout, NEVER follow redirects — a 3xx to any host would re-open the
/// SSRF the static+runtime guards close). `safe_addrs` must be non-empty; when
/// `validate_url_runtime` returns an empty vec (the dev loopback bypass) the caller
/// should use its default unpinned client instead.
pub fn pinned_webhook_client(
    host: &str,
    safe_addrs: &[SocketAddr],
) -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .resolve_to_addrs(host, safe_addrs)
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_http_scheme() {
        let err = validate_url_static("http://example.com/hook").unwrap_err();
        assert!(matches!(err, UrlGuardError::BadScheme(_)));
    }

    #[test]
    fn rejects_localhost_name() {
        assert!(validate_url_static("https://localhost/h").is_err());
        assert!(validate_url_static("https://api.local/h").is_err());
        assert!(validate_url_static("https://foo.internal/h").is_err());
        assert!(validate_url_static("https://x.localhost/h").is_err());
    }

    #[test]
    fn rejects_private_v4_literals() {
        for raw in [
            "https://127.0.0.1/h",
            "https://10.0.0.1/h",
            "https://172.16.0.1/h",
            "https://192.168.1.1/h",
            "https://169.254.169.254/h", // cloud metadata
            "https://0.0.0.0/h",
            "https://255.255.255.255/h",
            "https://100.64.0.1/h", // CGNAT
            "https://198.18.0.1/h", // benchmarking
            "https://240.0.0.1/h",  // reserved
            "https://192.0.2.1/h",  // documentation
        ] {
            assert!(validate_url_static(raw).is_err(), "should reject {raw}");
        }
    }

    #[test]
    fn rejects_private_v6_literals() {
        for raw in [
            "https://[::1]/h",
            "https://[fc00::1]/h",
            "https://[fe80::1]/h",
            "https://[ff00::1]/h", // multicast
            "https://[::ffff:127.0.0.1]/h",
            "https://[::ffff:10.0.0.1]/h",
        ] {
            assert!(validate_url_static(raw).is_err(), "should reject {raw}");
        }
    }

    /// Every entry here reaches a private/loopback IPv4 target through an IPv6
    /// literal, and every one of them PASSED before the embedded-v4 arms were
    /// added — `to_ipv4_mapped()` only recognises the `::ffff:` form.
    #[test]
    fn rejects_v6_literals_that_embed_a_private_v4() {
        for raw in [
            "https://[64:ff9b::7f00:1]/h",    // NAT64 -> 127.0.0.1
            "https://[64:ff9b::a00:1]/h",     // NAT64 -> 10.0.0.1
            "https://[64:ff9b::a9fe:a9fe]/h", // NAT64 -> 169.254.169.254 (cloud metadata)
            "https://[2002:7f00:1::]/h",      // 6to4  -> 127.0.0.1
            "https://[2002:c0a8:101::]/h",    // 6to4  -> 192.168.1.1
            "https://[::127.0.0.1]/h",        // IPv4-compatible -> loopback
            "https://[::10.0.0.1]/h",         // IPv4-compatible -> private
            "https://[2001:db8::1]/h",        // documentation range
            "https://[100::1]/h",             // discard-only (RFC 6666)
        ] {
            assert!(validate_url_static(raw).is_err(), "should reject {raw}");
        }
    }

    /// The embedded-v4 arms must DELEGATE, not blanket-block: a NAT64 or 6to4
    /// address wrapping a public v4 is still a legitimate destination. Blanket-
    /// blocking the prefixes would have been simpler and wrong.
    #[test]
    fn accepts_v6_literals_that_embed_a_public_v4() {
        for raw in [
            "https://[64:ff9b::101:101]/h", // NAT64 -> 1.1.1.1
            "https://[2002:0808:0808::]/h", // 6to4  -> 8.8.8.8
        ] {
            assert!(validate_url_static(raw).is_ok(), "should accept {raw}");
        }
    }

    #[test]
    fn accepts_public_https() {
        for raw in [
            "https://api.pegana.xyz/hook",
            "https://1.1.1.1/h",
            "https://8.8.8.8/h",
            "https://[2606:4700:4700::1111]/h",
            "https://example.com/path?query=1",
            "https://pegana-webhook-receiver.someuser.workers.dev/",
        ] {
            assert!(validate_url_static(raw).is_ok(), "should accept {raw}");
        }
    }

    #[test]
    fn rejects_bad_parse() {
        assert!(validate_url_static("not a url").is_err());
        assert!(validate_url_static("").is_err());
        assert!(validate_url_static("https://").is_err());
    }

    // ── runtime pin (DNS-rebinding TOCTOU close, P1 audit) ───────────────────────
    #[tokio::test]
    async fn runtime_pins_safe_ip_literal() {
        // A safe public IP literal → returns exactly that addr to pin (no DNS).
        let url = Url::parse("https://1.1.1.1/hook").unwrap();
        let addrs = validate_url_runtime(&url).await.expect("safe public IP");
        assert_eq!(
            addrs,
            vec![SocketAddr::new("1.1.1.1".parse().unwrap(), 443)]
        );
    }

    #[tokio::test]
    async fn runtime_rejects_unsafe_ip_literal() {
        // Defense-in-depth: even reaching runtime with a loopback/metadata IP
        // literal is rejected (not pinned to an internal target).
        for host in ["127.0.0.1", "169.254.169.254", "10.0.0.1", "192.168.1.1"] {
            let url = Url::parse(&format!("https://{host}/hook")).unwrap();
            assert!(
                validate_url_runtime(&url).await.is_err(),
                "unsafe IP literal {host} must be rejected"
            );
        }
    }

    #[tokio::test]
    async fn pinned_client_builds_for_safe_addr() {
        let addr = SocketAddr::new("1.1.1.1".parse().unwrap(), 443);
        assert!(pinned_webhook_client("example.com", &[addr]).is_ok());
    }
}
