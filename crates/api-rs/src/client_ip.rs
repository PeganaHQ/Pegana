//! Client address resolution for rate limits and per-IP caps.
//!
//! `X-Forwarded-For` is honoured only when the TCP peer is a trusted proxy
//! (the reverse proxy and sibling services); a request arriving from anywhere
//! else is keyed by its own peer address, so a compromised container cannot
//! rotate or impersonate client addresses by forging the header. IPv6
//! clients are keyed by their /64 and IPv4-mapped addresses by the embedded
//! IPv4, so one subscriber with a whole prefix cannot mint endless buckets.

use std::net::{IpAddr, Ipv6Addr, SocketAddr};
use std::sync::OnceLock;

use axum::http::HeaderMap;

const FORWARDED_FOR: &str = "x-forwarded-for";

/// One `addr/prefix` network.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cidr {
    addr: IpAddr,
    prefix: u8,
}

impl Cidr {
    pub fn parse(s: &str) -> Option<Self> {
        let s = s.trim();
        let (a, p) = match s.split_once('/') {
            Some((a, p)) => (a, Some(p)),
            None => (s, None),
        };
        let addr: IpAddr = a.parse().ok()?;
        let max = if addr.is_ipv4() { 32 } else { 128 };
        let prefix = match p {
            Some(p) => p.parse::<u8>().ok().filter(|p| *p <= max)?,
            None => max,
        };
        Some(Self { addr, prefix })
    }

    pub fn contains(&self, ip: IpAddr) -> bool {
        match (self.addr, ip) {
            (IpAddr::V4(n), IpAddr::V4(i)) => {
                mask_bits(u32::from(n) as u128, u32::from(i) as u128, self.prefix, 32)
            }
            (IpAddr::V6(n), IpAddr::V6(i)) => {
                mask_bits(u128::from(n), u128::from(i), self.prefix, 128)
            }
            _ => false,
        }
    }
}

fn mask_bits(net: u128, ip: u128, prefix: u8, width: u32) -> bool {
    if prefix == 0 {
        return true;
    }
    let shift = width - prefix as u32;
    (net >> shift) == (ip >> shift)
}

/// Peers allowed to set `X-Forwarded-For`.
#[derive(Debug, Clone)]
pub struct TrustedProxies(Vec<Cidr>);

impl TrustedProxies {
    /// Loopback and private ranges: the docker network and local development.
    /// Deployments should narrow this to the proxy's own subnet with
    /// `PEGANA_TRUSTED_PROXIES`.
    pub fn private_default() -> Self {
        Self(
            [
                "127.0.0.0/8",
                "10.0.0.0/8",
                "172.16.0.0/12",
                "192.168.0.0/16",
                "::1/128",
                "fc00::/7",
            ]
            .iter()
            .filter_map(|c| Cidr::parse(c))
            .collect(),
        )
    }

    /// Comma-separated CIDRs/addresses. Errors name the bad entry so a typo
    /// fails startup instead of silently trusting nothing.
    pub fn parse(list: &str) -> Result<Self, String> {
        let mut out = Vec::new();
        for entry in list.split(',').map(str::trim).filter(|e| !e.is_empty()) {
            out.push(Cidr::parse(entry).ok_or_else(|| format!("invalid CIDR '{entry}'"))?);
        }
        Ok(Self(out))
    }

    pub fn trusts(&self, ip: IpAddr) -> bool {
        let ip = unmap(ip);
        self.0.iter().any(|c| c.contains(ip))
    }
}

static TRUSTED: OnceLock<TrustedProxies> = OnceLock::new();

/// Install the trusted-proxy set once at startup.
pub fn init(trusted: TrustedProxies) {
    let _ = TRUSTED.set(trusted);
}

fn trusted() -> &'static TrustedProxies {
    TRUSTED.get_or_init(TrustedProxies::private_default)
}

fn unmap(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v6) => v6
            .to_ipv4_mapped()
            .map(IpAddr::V4)
            .unwrap_or(IpAddr::V6(v6)),
        v4 => v4,
    }
}

/// The bucket key for an address: IPv4-mapped → IPv4, IPv6 → its /64.
pub fn bucket(ip: IpAddr) -> IpAddr {
    match unmap(ip) {
        IpAddr::V6(v6) => {
            let mut seg = v6.segments();
            seg[4..].fill(0);
            IpAddr::V6(Ipv6Addr::from(seg))
        }
        v4 => v4,
    }
}

/// Resolve the client bucket for a request.
pub fn resolve(headers: &HeaderMap, conn: SocketAddr) -> IpAddr {
    resolve_with(trusted(), headers, conn)
}

pub fn resolve_with(trusted: &TrustedProxies, headers: &HeaderMap, conn: SocketAddr) -> IpAddr {
    let peer = conn.ip();
    if !trusted.trusts(peer) {
        return bucket(peer);
    }
    // Walk the chain right to left past trusted hops; the first address that
    // is not a trusted proxy is the client. All hops trusted → the leftmost.
    let mut leftmost: Option<IpAddr> = None;
    let values = headers
        .get_all(FORWARDED_FOR)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .collect::<Vec<_>>()
        .join(",");
    // From the right: a hop that does not parse was not added by a trusted
    // proxy, so stop trusting the header and key by the peer. That includes an
    // empty hop (`a,,b`) and a hop carrying a port (`1.2.3.4:5678`), which
    // Caddy never writes into X-Forwarded-For.
    for hop in values.rsplit(',') {
        let Ok(ip) = hop.trim().parse::<IpAddr>() else {
            return bucket(peer);
        };
        leftmost = Some(ip);
        if !trusted.trusts(ip) {
            return bucket(ip);
        }
    }
    bucket(leftmost.unwrap_or(peer))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hdr(v: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(FORWARDED_FOR, v.parse().unwrap());
        h
    }
    fn sock(s: &str) -> SocketAddr {
        s.parse().unwrap()
    }

    #[test]
    fn cidr_membership() {
        let c = Cidr::parse("172.16.0.0/12").unwrap();
        assert!(c.contains("172.31.255.1".parse().unwrap()));
        assert!(!c.contains("172.32.0.1".parse().unwrap()));
        assert!(Cidr::parse("fc00::/7")
            .unwrap()
            .contains("fd12::1".parse().unwrap()));
        assert!(Cidr::parse("nonsense").is_none());
        assert!(Cidr::parse("10.0.0.0/33").is_none());
        assert!(TrustedProxies::parse("10.0.0.0/8, bad").is_err());
    }

    #[test]
    fn xff_is_honoured_only_from_a_trusted_peer() {
        let t = TrustedProxies::parse("10.0.0.0/8").unwrap();
        // Trusted proxy: the forwarded client is used.
        assert_eq!(
            resolve_with(&t, &hdr("203.0.113.7"), sock("10.0.0.5:1")),
            "203.0.113.7".parse::<IpAddr>().unwrap()
        );
        // Untrusted peer forging the header: keyed by its own address.
        assert_eq!(
            resolve_with(&t, &hdr("203.0.113.7"), sock("198.51.100.9:1")),
            "198.51.100.9".parse::<IpAddr>().unwrap()
        );
        // Spoofed leftmost entry behind a trusted hop: rightmost untrusted wins.
        assert_eq!(
            resolve_with(
                &t,
                &hdr("1.1.1.1, 203.0.113.7, 10.0.0.9"),
                sock("10.0.0.5:1")
            ),
            "203.0.113.7".parse::<IpAddr>().unwrap()
        );
        // An unparseable hop stops the walk: keyed by the peer, not the spoof.
        assert_eq!(
            resolve_with(
                &t,
                &hdr("203.0.113.7, garbage, 10.0.0.9"),
                sock("10.0.0.5:1")
            ),
            "10.0.0.5".parse::<IpAddr>().unwrap()
        );
        // Garbage header falls back to the peer.
        assert_eq!(
            resolve_with(&t, &hdr("not-an-ip"), sock("10.0.0.5:1")),
            "10.0.0.5".parse::<IpAddr>().unwrap()
        );
    }

    #[test]
    fn ipv6_clients_share_a_bucket_per_64() {
        let a = bucket("2001:db8:1:2:aaaa::1".parse().unwrap());
        let b = bucket("2001:db8:1:2:bbbb::9".parse().unwrap());
        let c = bucket("2001:db8:1:3::1".parse().unwrap());
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(
            bucket("::ffff:203.0.113.7".parse().unwrap()),
            "203.0.113.7".parse::<IpAddr>().unwrap()
        );
    }
}
