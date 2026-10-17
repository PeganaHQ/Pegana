# Account UX redesign — v1.1.1

> Spec for the post-v1.1 polish pass on `/account/*` and the global header.
> Aim: make the console feel native to the rest of Pegana (Threshold Brackets +
> Bloomberg/Linear density), not a generic shadcn "logged-in area".

**Status:** approved, in implementation
**Branch:** main (small enough; commit-on-green)

## Why now

v1.1 shipped functional `/account/*` pages and a no-frills Sign In screen.
Two concrete problems surfaced when Rafael ran the smoke:

1. **Discoverability of `/account` is bad.** Header has no profile entry — to
   reach the console you have to either type the URL or click the link
   buried inside `/account` itself. New users will never find it.
2. **AssetCard "alert" CTA is a Telegram deep-link.** Works for first-time
   visitors with zero auth, but **for users already logged in via the web, it
   round-trips through Telegram unnecessarily** — they should be able to
   subscribe in one click without leaving the page.

This spec fixes both, and rebuilds `/account/*` as a real console with a
left-rail navigation pattern (Linear / Vercel / Stripe Dashboard idiom).

## References (reviewed; cherry-picked)

| Product | Pattern lifted | Pattern rejected |
|---|---|---|
| **Linear** | dense left-rail sidebar, mono section labels, current-route highlight via subtle bg | rounded corners, soft shadows |
| **Vercel Dashboard** | top-right avatar dropdown with user header inside, "Sign out" at the bottom | full breadcrumb pattern (over-architected for 3 routes) |
| **Stripe Dashboard** | persistent sidebar with sub-sections, breadcrumb above page header | dual-pane main+detail (we don't need it for 3 routes) |
| **Tensor** (Solana) | wallet/account chip at top-right with truncated handle | the floating bottom bar (mobile-only pattern) |
| **Cron / Sunsama** | small initials avatar with subtle gradient | bright avatar photos competing with content |

**Direction:** dense left-rail (Linear) + chip in header (Vercel) + sharp/mono
brand from Pegana itself. No new visual language — extend what's locked.

## Decisions

### 1. AccountChip in the global header

Sits between the existing "Get the bot" CTA and the mobile menu trigger.

**Not authed:** renders the `<TelegramLoginButton>` inline (no script — just a
small "Sign in" link that routes to `/account`, since the widget needs the
script and we don't want the script on every page). The full widget renders
on `/account` itself.

**Authed:** square 28×28 chip with the user's initials over an iridescent
gradient (the *only* iridescent surface in the header — restraint). On `lg+`,
the username (`@raffxsolana`) renders next to the chip in mono. Clicking it
opens a dropdown menu.

**Dropdown contents:**

```
┌──────────────────────────┐
│ @raffxsolana             │  ← user header (mono, text-muted)
│ ID 6647651772            │
├──────────────────────────┤
│ → My account             │
│ → Subscriptions          │
│ → Alerts                 │
├──────────────────────────┤
│ ⎋ Sign out               │  ← destructive-tinted on hover
└──────────────────────────┘
```

**Why a dropdown (vs. linking straight to `/account`):**

- Sign out is reachable from anywhere — single most common destructive action,
  shouldn't require navigating to a settings page first.
- Subscriptions + Alerts are read-often from any page — quick jump.

Use **shadcn `<DropdownMenu>`** (not yet installed — `npx shadcn@latest add dropdown-menu`).

### 2. `/account` layout with persistent left sidebar

New file `web/app/(app)/account/layout.tsx` wraps all `/account/*` routes:

```
┌────────────────────────────────────────────────────────────┐
│  ProductHeader (existing global)                           │
├──────────────┬─────────────────────────────────────────────┤
│              │                                              │
│  Console     │                                              │
│              │                                              │
│  PROFILE     │   <page content>                             │
│  Subs   1    │                                              │
│  Alerts      │                                              │
│              │                                              │
│  ─────────   │                                              │
│              │                                              │
│  Sign out    │                                              │
│              │                                              │
└──────────────┴─────────────────────────────────────────────┘
```

**Mobile (<lg):** sidebar collapses to a horizontal scroll-snap nav bar at
the top of the page (no Sheet drawer — it's only 3 items, drawer would
be overkill). Sticky below the global header.

**Sidebar conventions:**

- Width `w-56` (224px) on lg+, full-width horizontal on mobile.
- Section labels: `font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted`.
- Active route: `text-text` + 1px left border (`border-l border-text`) + 12px left padding shift to absorb the border (no layout jitter).
- Hover (non-active): `text-text` (no bg change — borders only on active).
- Subscription count badge: `font-mono text-[10px] text-text-caption` right-aligned.
- Sign out: separated by hairline rule above it.

### 3. AlertMeButton (replaces hover-revealed deep-link)

Current `asset-table.tsx:164-176` renders a hover-revealed `<a>` that opens
`t.me/PeganaWatchBot?start=src_dashboard_<asset>` — fine for unauth but skips
the in-place flow when the user is signed in.

**New behavior:**

```tsx
<AlertMeButton asset={a.symbol} />
```

- **Not authed:** anchor with the existing `peganaBotHref('dashboard', asset)`
  href — exact same UX as today.
- **Authed:** button. On click, opens a `<SubscribeModal asset={...} />`
  with a threshold slider (default 50bps) and a "Subscribe" confirm.
  On confirm: `meApi.createSub(token, asset, bps)` → toast → close.

The modal uses **shadcn `<Dialog>`** (not yet installed — `npx shadcn@latest add dialog`).

**Modal layout:**

```
┌──────────────────────────────────────────┐
│ Alert on jitoSOL                    [✕]  │
├──────────────────────────────────────────┤
│                                          │
│  Threshold                               │
│  ●━━━━━━━━━━━━━━━━━━━━○━━━━━     0.50%   │
│  0.05%                          5.00%    │
│                                          │
│  You'll get a Telegram alert when        │
│  jitoSOL drifts more than 0.50% from     │
│  its intrinsic SOL value.                │
│                                          │
├──────────────────────────────────────────┤
│         [Cancel]    [Subscribe]          │
└──────────────────────────────────────────┘
```

- Surface: `surface-1` background, `hairline` border.
- Submit button: `data-cta="primary"` (iridescent glow on hover).
- Toast on success: native `aria-live="polite"` div top-right; auto-dismiss 3s.

### 4. AlertMeButton — pre-existing sub awareness

If the user already has an active sub on this asset, the button text becomes
**"✓ Watching"** (text-muted) and clicking opens the modal pre-filled with
the current threshold for editing.

Requires fetching `/v1/me/subs` once on dashboard mount when authed. Cache via
SWR for 30s (matches dashboard refresh cadence).

### 5. Sign-in screen polish on `/account`

When unauthed and landing on `/account`, current UX is fine but a bit blank.
Add:

- Single-line value prop above the button: "Manage your subscriptions and
  alert history from the same Telegram identity that runs in @PeganaWatchBot."
- Below the button: row of 3 mono labels with subtle pips —
  `mesma identidade · same DB · sync <1s`. Reinforces the cross-surface story.
- No emoji.

## Files

| File | Action | Purpose |
|---|---|---|
| `brand.md` | create | Brand source of truth (done) |
| `web/components/atoms/account-chip.tsx` | create | Header chip + initials avatar |
| `web/components/molecules/account-menu.tsx` | create | DropdownMenu wrapper |
| `web/components/organisms/product-header.tsx` | modify | Inject AccountChip between CTA and MobileMenu |
| `web/components/ui/dropdown-menu.tsx` | create (via shadcn) | shadcn primitive |
| `web/components/ui/dialog.tsx` | create (via shadcn) | shadcn primitive |
| `web/app/(app)/account/layout.tsx` | create | Sidebar wrapper |
| `web/components/molecules/account-sidebar.tsx` | create | Sidebar nav |
| `web/app/(app)/account/page.tsx` | modify | Use sidebar layout |
| `web/app/(app)/account/subscriptions/page.tsx` | modify | Same |
| `web/app/(app)/account/alerts/page.tsx` | modify | Same |
| `web/components/molecules/alert-me-button.tsx` | create | Smart button (auth-aware) |
| `web/components/molecules/subscribe-modal.tsx` | create | Threshold modal |
| `web/lib/hooks/use-my-subs.ts` | create | SWR for `/v1/me/subs` (auth-gated) |
| `web/components/organisms/asset-table.tsx` | modify | Swap `<a>` for `<AlertMeButton>` |
| `web/components/atoms/toast.tsx` | create | Minimal toast (no shadcn — single use) |

## Non-functional checks (from frontend-design-guidelines)

- [ ] All interactive elements are `<button>` or `<a href>`
- [ ] Focus ring visible (already global `:focus-visible` in globals.css)
- [ ] Hit targets ≥40×40 (chip is 28×28 visual but pad to 40×40)
- [ ] Loading/empty/error states present on AccountChip (loading skeleton during AuthProvider rehydration), SubscribeModal (busy state on submit), sidebar count badge (— when subs not loaded yet)
- [ ] `prefers-reduced-motion` already global guard
- [ ] All colors from tokens
- [ ] Sign out has confirm via dropdown affordance (no "are you sure" — single-click; user can sign back in immediately)

## Out of scope

- Wallet connect (not in v1.x — Telegram is the identity)
- "Switch organization" pattern (single-tenant identity)
- Settings sub-sections (notifications, billing) — deferred until those exist
- Editing username (Telegram-owned)
- Dark/light toggle (app is dark-only)

## Validation

Smoke after each task:

1. Open `/` (logged out) → header shows "Sign in" (or button to /account)
2. Sign in via `/account` → header shows AccountChip with initials
3. Click chip → dropdown opens with user header + 3 links + sign out
4. Click "Subscriptions" → goes to `/account/subscriptions`, sidebar shows it active with left border
5. Resize window <lg → sidebar collapses to horizontal nav at top
6. Open `/dashboard` while authed → AlertMeButton on jitoSOL row reads "✓ Watching" (because of pre-existing sub)
7. Open `/dashboard` while authed → click AlertMe on a new asset → modal opens, slide threshold, Subscribe → toast → reload `/account/subscriptions` shows new row
8. Sign out → header chip swaps back to "Sign in"
