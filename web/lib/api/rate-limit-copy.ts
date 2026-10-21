// Shared wording for a 429 from the public API. The API allows 60 requests a
// minute per IP; when a browser (or everyone behind the same NAT/VPN) uses
// that up, the API is still healthy. Every "feed unreachable" surface swaps to
// this copy on a 429 so a rate limit is never presented as an outage.
export const RATE_LIMITED_LABEL = "Rate limited";
export const RATE_LIMITED_BODY =
  "The Pegana API is up, but it allows 60 requests a minute per IP and this network has used them. This retries on its own within a minute.";
