# ADR-0045 — One installable web app, not native iOS and Android clients

- **Status:** **Accepted** (2026-08-11). Implemented in the same pass.
- **Scope:** the mobile strategy for `web/` only. No backend, methodology, or receipt impact.
- **Supersedes:** nothing. Narrows the `ROADMAP.md` "Telegram Mini App" trigger row by making the
  no-native default explicit rather than implied.

## Context

The question put to this decision was: should Pegana ship iOS and Android apps that behave
differently from one another, or adopt a single Apple-derived interaction language for both?

There is a prior question that has to be answered first, because it dominates: should there be a
native app at all?

Today's mobile surface is a responsive Next.js console with a manifest and icons. It is
installable in the sense that a browser will let you add it to a home screen, and no further than
that: no service worker, no offline document, no `appleWebApp` metadata, no shortcuts, and a
`start_url` of `/`, so tapping the installed icon opened the marketing landing rather than the
console.

## Decision

**One installable web app. One interaction language, derived from Apple's Human Interface
Guidelines, applied identically on both platforms. No native shell, and no per-platform UI fork.**

## Why not native

**The demand is not there, and the repo already says so.** `ROADMAP.md` gates even a *Telegram
Mini App* — five days of work — behind "60%+ mobile traffic OR partner ask". The anti-roadmap
bans building ahead of demand outright. A native client is an order of magnitude past that bar
and there are zero paying users to justify it.

**The one capability that argues for native is already solved better.** Push is the honest reason
most products go native. Pegana already delivers peg alerts over Telegram and webhooks. For this
audience that is *better* than APNs or FCM: no install required, no store review, it reaches
desktop and mobile from one delivery path, and it works today.

**A store presence adds a release gate to a freshness product.** Pegana's value is that its
numbers are current. Putting a multi-day review between a fix and its users is a poor trade for a
product whose worst failure mode is showing a stale state.

## Why not fork iOS and Android

**One founder cannot keep two interaction languages honest.** This repo already carries one
documented duplication, the `v2.css` token set mirroring `globals.css`, and it has cost real bugs
and needs a parity guard test to hold. A second, larger duplication across two platforms would
not survive.

**`DESIGN.md` specifies a single motion system** with named eases and a mandatory reduced-motion
matrix. Forking it means two matrices to audit, and the reduced-motion matrix is the part that is
already easiest to regress.

**The platforms agree where it matters.** Material's bottom-navigation guidance and Apple's
tab-bar guidance both call for persistent bottom tabs, three to five destinations, and no nested
tabs. What differs is cosmetic, and importing cosmetic divergence is exactly what a brand-led
product should not do.

## What "full Apple" means here

Not iOS chrome pastiche, and not skeuomorphism. It means adopting the *behaviours* users read as
"this is an app", and applying them to Android too, where they are a superset of what Material
asks for:

1. A persistent bottom tab bar owns the primary destinations. Everything else lives in a sheet.
2. Sheets rise from the bottom, are dismissed by the platform (Escape, backdrop), and never nest.
3. Navigation has direction. Forward pushes, back pops, siblings crossfade.
4. Chrome does not move during a push. Only content moves.
5. Minimum 44px touch targets; `env(safe-area-inset-*)` respected on every fixed edge.
6. No tap-highlight rectangle, no 300ms click delay, no scroll chaining out of a sheet.

## What ships

- `app/manifest.ts` as a typed metadata route, with `id`, `display_override`, four `shortcuts`,
  and `start_url: "/dashboard?source=pwa"` so an installed Pegana opens the console.
- `appleWebApp` metadata: `capable`, `black-translucent`, and a short `title` so the home-screen
  label is not the 34-character marketing title.
- A minimal service worker, an offline document, and an install affordance that lives inside the
  mobile sheet and never interrupts.

## The service-worker constraint (non-negotiable)

**The service worker never caches peg data.** `/v1/*`, `/api/*`, `/monitoring` and `/auth/*` go
straight to the network with no cache entry, ever.

Pegana exists to tell you an asset has moved off its peg. A cached state, spread or price served
offline is visually indistinguishable from a live one, so it would fail *silently and
confidently* — which is worse than not answering. Offline shows the offline document, which
deliberately displays no numbers at all.

Navigations are network-first for the same class of reason: cache-first HTML is how one bad
deploy pins a stale document that users cannot clear. Only content-hashed assets
(`/_next/static/*`, `/tokens/*`, fonts) are cache-first, where the URL changes when the bytes do.

A kill switch (`postMessage({ type: "PEGANA_SW_KILL" })`) and an environment flag
(`NEXT_PUBLIC_DISABLE_SW=1`) can both retire the worker without asking users to clear site data.
`tests/unit/app/pwa.test.ts` pins all of the above.

## Consequences

- No App Store or Play Store presence, and no push notifications through them. Telegram and
  webhooks remain the alert path.
- iOS Web Push is available to home-screen web apps if a future need appears; it does not require
  revisiting this decision.
- If a partner ever asks for a native client, this ADR is the thing to reopen. The trigger is a
  named partner, not a traffic percentage: the interaction language settled here would be the
  starting point for a native shell anyway, so nothing built now is wasted.

## Revisit when

Any one of: a design partner explicitly requires a store listing; mobile exceeds 60% of sessions
*and* installs materially trail; or Web Push becomes the primary alert channel over Telegram.
