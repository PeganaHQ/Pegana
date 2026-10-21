//! Uniform response envelopes for the `/v1` read surface.
//!
//! Every read endpoint returns an OBJECT (never a bare array), so a consumer can
//! always branch on the same shape and we can add top-level fields (paging,
//! meta) without a breaking change (Zalando/Stripe convention). Lists carry a
//! `count`; single resources omit it. `generated_at` is an explicit build-time
//! staleness read independent of HTTP caching headers.
//!
//! These are pure re-serialization wrappers over the payload each handler
//! already computes — no new business logic (mirrors how `/v1/peg/feed` already
//! re-shapes `AssetCard`).

use chrono::Utc;
use serde::Serialize;
use utoipa::ToSchema;

/// List envelope: `{ ok, generated_at, count, data: [...] }`.
#[derive(Debug, Serialize, ToSchema)]
pub struct ApiList<T> {
    /// Always `true` on a 2xx; errors use the `{error, message}` envelope instead.
    pub ok: bool,
    /// RFC3339 (UTC, millisecond, `Z`) build time of this response.
    pub generated_at: String,
    /// Number of items in `data`.
    pub count: usize,
    pub data: Vec<T>,
    /// Time-series lists only (`/v1/assets/{symbol}/history`): RFC3339 of the
    /// earliest snapshot Pegana has stored for the asset. Nothing exists before
    /// it, so an empty or short window ending earlier is a data floor, not an
    /// absence of events. Omitted elsewhere.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub history_start: Option<String>,
    /// Time-series lists only (`/v1/assets/{symbol}/history`): `true` when the
    /// window holds more rows than `limit`, so `data` stops before `from`.
    /// Always present there (`false` when the window fit). Omitted elsewhere.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub truncated: Option<bool>,
    /// Present only when `truncated` is `true`: RFC3339 (microsecond, `Z`)
    /// instant just before the oldest row returned. Repeat the request with
    /// `from=<next_from>&to=<next_to>` (same `bucket`, `limit`) to get the
    /// next, older page; no row is skipped or repeated.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_to: Option<String>,
    /// Present only when `truncated` is `true`: the EFFECTIVE lower bound of
    /// this window (RFC3339, microsecond, `Z`), i.e. the `from` the request
    /// sent or the default it got (now minus 24h). Pass it back as `from`
    /// with `next_to`: the default `from` is `Utc::now() - 24h`, not
    /// `to - 24h`, so paging without `from` keeps `from` at now-24h and, once
    /// `next_to` is older than 24h, the request returns 400 `invalid_range`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_from: Option<String>,
}

impl<T> ApiList<T> {
    pub fn new(data: Vec<T>) -> Self {
        Self {
            ok: true,
            generated_at: crate::serde_fmt::rfc3339_millis_z(&Utc::now()),
            count: data.len(),
            data,
            history_start: None,
            truncated: None,
            next_to: None,
            next_from: None,
        }
    }

    /// Attach the asset's stored-history floor (see `history_start`).
    pub fn with_history_start(mut self, start: Option<String>) -> Self {
        self.history_start = start;
        self
    }

    /// Attach the time-series truncation signal (see `truncated`, `next_to`
    /// and `next_from`). The cursors are dropped when the window fit.
    pub fn with_truncation(
        mut self,
        truncated: bool,
        next_to: Option<String>,
        next_from: Option<String>,
    ) -> Self {
        self.truncated = Some(truncated);
        self.next_to = if truncated { next_to } else { None };
        self.next_from = if truncated { next_from } else { None };
        self
    }

    /// Same envelope, but stamped with WHEN THE DATA WAS COMPUTED rather than
    /// when the response was built.
    ///
    /// Required by any handler served from a cache. `generated_at` is documented
    /// above as "an explicit build-time staleness read"; a cached payload
    /// re-wrapped with `new()` would claim `now` for data that may be up to a
    /// TTL old, which is exactly the staleness lie this field exists to prevent.
    /// On a product whose pitch is honest freshness, that matters more than the
    /// latency it buys.
    pub fn with_generated_at(data: Vec<T>, generated_at: String) -> Self {
        Self {
            ok: true,
            generated_at,
            count: data.len(),
            data,
            history_start: None,
            truncated: None,
            next_to: None,
            next_from: None,
        }
    }
}

/// Single-resource envelope: `{ ok, generated_at, data: {...} }`.
///
/// Deliberately UNUSED today: the reshape (ADR-0043, "Option A") keeps single
/// resources bare (Stripe/GitHub convention), so only lists are enveloped
/// (`ApiList`). This is the ready extension point for the optional additive
/// follow-up "envelope single resources too"; `#[allow(dead_code)]` holds it
/// until then.
#[allow(dead_code)]
#[derive(Debug, Serialize, ToSchema)]
pub struct ApiOne<T> {
    pub ok: bool,
    pub generated_at: String,
    pub data: T,
}

#[allow(dead_code)]
impl<T> ApiOne<T> {
    pub fn new(data: T) -> Self {
        Self {
            ok: true,
            generated_at: crate::serde_fmt::rfc3339_millis_z(&Utc::now()),
            data,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Serialize;

    #[derive(Debug, Serialize)]
    struct Item {
        symbol: String,
    }

    /// The list envelope is exactly `{ ok:true, generated_at:<rfc3339 ms Z>,
    /// count:N, data:[...] }`; top-level object (never a bare array), `count`
    /// mirrors `data.len()`, and `generated_at` is the normalised millisecond-Z
    /// timestamp. This is the wire contract every list endpoint now returns.
    #[test]
    fn list_envelope_shape() {
        let env = ApiList::new(vec![
            Item {
                symbol: "USDC".into(),
            },
            Item {
                symbol: "hyUSD".into(),
            },
        ]);
        let v = serde_json::to_value(&env).expect("serialize");
        let obj = v
            .as_object()
            .expect("envelope is a JSON object, never a bare array");

        assert_eq!(obj.get("ok").and_then(|x| x.as_bool()), Some(true));
        assert_eq!(obj.get("count").and_then(|x| x.as_u64()), Some(2));
        assert!(
            obj.get("data").and_then(|x| x.as_array()).is_some(),
            "data is an array"
        );
        assert_eq!(v["data"].as_array().unwrap().len(), 2);
        assert_eq!(v["data"][0]["symbol"].as_str(), Some("USDC"));

        // generated_at is RFC3339, millisecond precision, `Z` suffix.
        let ts = obj
            .get("generated_at")
            .and_then(|x| x.as_str())
            .expect("generated_at present");
        assert!(ts.ends_with('Z'), "Z-suffixed: {ts}");
        assert!(
            chrono::DateTime::parse_from_rfc3339(ts).is_ok(),
            "generated_at parses as RFC3339: {ts}"
        );
        // `.SSSZ` → 3 fractional digits + Z (e.g. 2026-07-24T15:33:14.545Z).
        let frac = &ts[ts.len() - 5..ts.len() - 1];
        assert!(frac.starts_with('.'), "millisecond fraction present: {ts}");
    }

    /// Empty list still serialises as the object envelope with `count:0` and an
    /// empty `data` array; NOT `null`, NOT a bare `[]`; so a consumer branches
    /// on one shape regardless of result size (feature-gated `/v1/audit`,
    /// unknown-symbol `/history`).
    #[test]
    fn list_envelope_empty_is_object_not_bare_array() {
        let env: ApiList<Item> = ApiList::new(Vec::new());
        let v = serde_json::to_value(&env).expect("serialize");
        assert!(v.is_object(), "empty envelope is still an object: {v}");
        assert_eq!(v["count"].as_u64(), Some(0));
        assert!(v["data"].as_array().unwrap().is_empty());
    }

    /// The single-resource envelope is `{ ok:true, generated_at, data:{...} }`;
    /// no `count`, `data` is the object itself (F3 object endpoints).
    #[test]
    fn one_envelope_shape() {
        let env = ApiOne::new(Item {
            symbol: "USDC".into(),
        });
        let v = serde_json::to_value(&env).expect("serialize");
        let obj = v.as_object().expect("object envelope");
        assert_eq!(obj.get("ok").and_then(|x| x.as_bool()), Some(true));
        assert!(
            !obj.contains_key("count"),
            "single envelope omits count: {v}"
        );
        assert_eq!(v["data"]["symbol"].as_str(), Some("USDC"));
        assert!(obj.get("generated_at").and_then(|x| x.as_str()).is_some());
    }
}
