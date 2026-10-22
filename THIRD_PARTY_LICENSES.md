# Third-party assets and marks

Pegana displays third-party names and logos to identify the assets it monitors.
This file records the posture on those, and on any asset vendored into the repo.

## Fonts

No font binaries are vendored in this repository. The pegana.xyz website,
which is proprietary and not part of this repository, loads its own licensed
web fonts.

## Token and protocol logos

Pegana does **not** vendor third-party token logos as committed image files.
The pegana.xyz website relays logos at request time through a same-origin
proxy, which resolves the image URL server-side from the mint's own published
`logoUri` and never from a caller-supplied string. Nothing is stored.

Regardless of how they are served, the posture on the marks themselves:

- Token, protocol and company names and logos remain the property of their
  respective owners.
- They are used **solely to identify** the corresponding asset or data provider,
  which is nominative use. Their display implies no affiliation, sponsorship, or
  endorsement in either direction.
- No license to reuse any mark is granted by this repository beyond what the
  owner's own trademark policy permits.
- If you are a rights holder and want a mark removed, open an issue or contact
  the maintainer, and it will be removed promptly.

## Data providers

Pegana reads from third-party APIs (Sanctum, Jupiter, Pyth, DexScreener,
lst-directory.com, tokens.xyz, Kamino, Jupiter Lend). Their names appear in the
product for source attribution. Attribution is not endorsement, and each
provider's terms govern that provider's data.

## Code adapted from other projects

- Parts of `crates/xtask/src/hygiene.rs`, `crates/xtask/src/smoke/mod.rs`, the
  stale-response fallback in `crates/api-rs/src/routes/assets.rs`, and the
  scoring shape in `crates/api-rs/src/market_score.rs` are adapted from
  [`solana-foundation/tokens`](https://github.com/solana-foundation/tokens),
  MIT licensed. Each adapted site names its origin in a comment. Their MIT
  notice is reproduced below.

```
MIT License

Copyright (c) 2026 Solana Foundation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Adding a vendored asset

Do not commit a third-party binary asset without first confirming redistribution
rights and adding an entry here naming the asset, its owner, and the license or
policy that permits redistribution.
