import type { Metadata } from "next";
import { HomeClient } from "./home-client";

/**
 * Server shell for the homepage.
 *
 * The landing page itself is a client component (live board, Lenis scroll,
 * scroll-driven reveals), so it cannot export metadata — which left the
 * homepage as the LAST route on the site with no canonical, so `/?ref=…` and
 * other query variants competed with it.
 *
 * Deliberately NOT routed through `pageMetadata()`. That helper passes `title`
 * bare so the root layout's `template: "%s — Pegana"` appends the brand — but
 * the homepage's title already IS "Pegana — peg-risk oracle for Solana", so the
 * template would render it as "… — Pegana — Pegana". Title, description and
 * openGraph are inherited from the root on purpose; this adds the self-canonical
 * the root deliberately omits (a hardcoded "/" up there would canonicalise every
 * page to the homepage — a regression this repo has shipped before).
 */
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return <HomeClient />;
}
