import { switzerV2, geistMonoV2 } from "@/app/fonts/v2-fonts";
import { cn } from "@/lib/utils/cn";
import { ErrorSurfaceV2 } from "@/components/organisms/v2/error-surface-v2";

// Trust-Layer v0.1.0 / Wave 10A. 404 dedicated to "evidence_missing" —
// distinct from the global 404 because the URL itself may be a valid UUID
// but the audit ledger has nothing for it (e.g. predated the trust layer,
// typo, or the alert was never observed by the engine).
//
// V5 port (W1, 2026-07-03): not standalone — the (marketing) layout already
// wraps this route in SiteNavV2/SiteFooterV2 chrome, so this only needs its
// own .pegana-v2 token scope for the surface itself (v2.css is already
// loaded by the layout's chrome components, so no import here) at a shorter
// ~70vh height rather than a full standalone page.

export default function NotFound() {
  return (
    <div className={cn("pegana-v2", switzerV2.variable, geistMonoV2.variable)}>
      <ErrorSurfaceV2
        eyebrow="Receipt not found"
        headline="No receipt under that ID."
        sub="Every alert ships a verifiable receipt. The ledger holds the full history."
        state="unknown"
        endLabel="?"
        primary={{ label: "Open the audit log", href: "/audit" }}
        secondary={{ label: "Back to home", href: "/" }}
      />
    </div>
  );
}
