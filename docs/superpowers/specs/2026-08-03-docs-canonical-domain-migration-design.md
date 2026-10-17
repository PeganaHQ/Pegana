# Docs canonical-domain migration design

**Date:** 2026-08-03  
**Status:** Approved

## Goal

Make `https://docs.pegana.xyz` the only canonical public documentation origin while preserving backward compatibility for existing `/docs` links.

## Architecture

- `https://docs.pegana.xyz/*` serves Mintlify directly.
- `https://www.pegana.xyz/docs` permanently redirects to `https://docs.pegana.xyz`.
- `https://www.pegana.xyz/docs/*` permanently redirects to the same path on `https://docs.pegana.xyz/*`.
- Apex equivalents under `https://pegana.xyz/docs*` resolve directly to the docs subdomain when Vercel redirect ordering permits it.
- Other apex paths retain the existing permanent redirect to `https://www.pegana.xyz/*`.
- The web project no longer rewrites or proxies Mintlify content under `/docs`.

## Public references

Active links in web navigation, marketing pages, machine-readable discovery, SDK metadata, SDK READMEs, Mintlify configuration, deployment instructions, and current operational documentation point directly to `https://docs.pegana.xyz`.

Relative `/docs` links are removed from active product surfaces. Historical audit evidence remains unchanged when the old URL is part of the recorded event rather than a current instruction.

## Mintlify

The Pegana deployment uses `docs.pegana.xyz` as its connected custom domain. Rendered documentation pages must emit one canonical link whose host is `docs.pegana.xyz`, with the page path preserved. No canonical may reference `www.pegana.xyz`, `pegana.xyz/docs`, or `pegana.mintlify.dev`.

## Compatibility redirects

Vercel owns legacy `/docs` compatibility redirects. Redirects are permanent, preserve nested paths and query strings, and precede the generic apex-to-www catch-all. Legacy in-app documentation routes such as `/concepts`, `/learn`, `/developers`, and `/changelog` redirect directly to their corresponding docs-subdomain pages.

## Tests

Automated tests assert:

- no `/docs` Mintlify rewrite remains;
- exact and wildcard `/docs` redirects target `docs.pegana.xyz` and precede the apex catch-all;
- legacy Next.js redirects use absolute docs-subdomain destinations;
- generated `llms.txt` content advertises the docs subdomain and not old public docs URLs;
- obsolete proxy/CSP exceptions for proxied Mintlify HTML are removed.

Production verification checks DNS/TLS, redirects without following them, final status codes, effective URLs, `llms.txt`, and canonical tags on representative documentation pages.

## Rollback

If the custom domain becomes unavailable, restore the prior Vercel `/docs` rewrites to the Mintlify upstream and revert active links to `/docs`. DNS and Mintlify custom-domain changes remain operator-controlled and must be rolled back together with repository routing.

## Out of scope

- Rewriting dated historical evidence solely for URL consistency.
- Changing Mintlify vendor URLs or its schema URL.
- Publishing SDK packages; metadata is updated here, publication remains a separate release action.
