import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/page-metadata";
import { WhatsNewClient } from "./whats-new-client";

export const metadata: Metadata = pageMetadata({
  title: "What's New",
  description:
    "The relaunch: the peg-risk oracle, now proven on-chain. Every verdict re-derives byte-for-byte, and severe transitions can be anchored on Solana mainnet. A hardened methodology, a closed security gap, and an app rebuilt to never show a number it can't stand behind.",
  path: "/whats-new",
});

// Thin server wrapper (owns metadata) → the animated client page. Built in
// Pegana's own V5 landing language (DESIGN.md): centred Switzer hero with the
// distance-field ambient, the real on-chain receipt floated under the
// iridescent arc, editorial ListRowsV2 change-tables, the canonical stat
// strip, and the DecorWave close. Every claim reflects validated, shipped
// reality (see the honesty pass in the client component).
export default function WhatsNewPage() {
  return <WhatsNewClient />;
}
