# releases.pegana.xyz — install mirror

## DNS

CNAME `releases.pegana.xyz -> github.com` (Cloudflare; auto-renews).

## Caddy reverse proxy (Hetzner)

Append to `/opt/pegana/Caddyfile`:

```
releases.pegana.xyz {
    # Static install scripts (ADR-0008 — Sigstore-verifying installer).
    handle_path /install.sh {
        rewrite * /scripts/install.sh
        file_server { root /opt/pegana/repo }
    }
    handle_path /install.ps1 {
        rewrite * /scripts/install.ps1
        file_server { root /opt/pegana/repo }
    }

    # Everything else proxies to GitHub Releases (binaries, manifests).
    reverse_proxy https://github.com/lrafasouza/pegana/releases/latest/download {
        header_up Host {upstream_hostport}
    }
    header Strict-Transport-Security "max-age=31536000"
    header X-Content-Type-Options "nosniff"
}
```

Reload Caddy: `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`.

## Trust boundary (ADR-0008)

- **The CNAME is NOT a trust dependency for binaries.** `install.sh` fetches
  binaries directly from `github.com/lrafasouza/pegana/releases/*`, then
  verifies the Sigstore attestation chain rooted at GitHub's OIDC identity.
- **Two verification paths are tried in order; install fails closed if both fail.**
  1. `gh attestation verify` — cheapest if the `gh` CLI is on PATH.
  2. `cosign verify-blob` — if `gh` is missing, the script downloads
     standalone cosign (~30MB) into a tmpdir along with the
     `<artifact>.sigstore` bundle published by `actions/attest-build-provenance`
     and verifies offline. The cosign call pins
     `--certificate-oidc-issuer https://token.actions.githubusercontent.com`
     and a `--certificate-identity-regexp` matching the official release
     workflow under `github.com/lrafasouza/pegana`.
  3. If BOTH paths fail, the script exits with code 6. The previous
     fail-open path (WARNING + 5-second sleep + install-anyway) is gone —
     a `gh`-less machine no longer collapses the trust pitch silently.
- **The CNAME IS still a trust dependency for the install script itself.**
  If a future hijack swaps `install.sh`, the swapped script could skip
  the verify step. Defense: publish the SHA256 of `install.sh` on the
  `/methodology#verify` page; advanced users can verify before piping
  to `sh`.

## Acceptance criteria

- AC54: `curl ... releases.pegana.xyz/install.sh | sh` installs `pegana-replay`
- AC55: `install.sh` refuses if `gh attestation verify` AND `cosign verify-blob`
  both fail (ADR-0008; audit B P1 fix removed the prior `gh`-missing fail-open)
- AC56: binaries fetched from github.com (not via CNAME) — CNAME outage
  only affects script delivery, not the binary trust root
- AC57: when `gh` CLI is missing, `install.sh` falls back to downloading
  cosign + the `.sigstore` bundle. Both downloads land in a tmpdir wiped
  by `trap cleanup` — no leftover state in `$HOME`.
