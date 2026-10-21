import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/page-metadata";
import { CodeBlock } from "@/components/molecules/code-block";

// Landing for releases.pegana.xyz.
//
// Lean by design — this host exists to serve the installer script and the
// pre-built binaries. The landing tells visitors exactly what the install
// invocation is and points them back to the methodology page for the
// integrity story. No marketing chrome (no CalibrationBanner, no site nav,
// no site footer) because the wrapper layout under app/(marketing) doesn't
// apply here.

export const metadata: Metadata = pageMetadata({
  // No middle dot here: the root template appends " · Pegana", and AGENTS.md
  // caps middle dots at one per line.
  title: "pegana-replay releases",
  description:
    "Self-hosted installer mirror for the pegana-replay CLI. Verify any Pegana alert against the open-source methodology crate.",
  path: "/releases",
});

const INSTALL_SNIPPET = `curl --proto '=https' --tlsv1.2 -LsSf \\
  https://releases.pegana.xyz/pegana-replay-installer.sh | sh`;

const VERIFY_SNIPPET = `pegana-replay --alert-id <UUID>            # re-derive hash + verify anchor if present
pegana-replay --alert-id <UUID> --offline  # hash-only, no RPC call`;

export default function ReleasesLanding() {
  return (
    <main className="min-h-screen bg-canvas px-5 py-16 sm:px-8 sm:py-24 lg:px-12">
      <div className="mx-auto max-w-2xl">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-caption">
          releases.pegana.xyz
        </p>
        <h1 className="mt-4 text-[36px] font-medium leading-[1.05] tracking-[-0.02em] text-text sm:text-[48px]">
          pegana-replay
        </h1>
        <p className="mt-4 font-mono text-[12px] text-text-muted">
          self-hosted mirror
        </p>

        <p className="mt-8 text-[16px] leading-[1.6] text-text-body">
          A small CLI that verifies a Pegana alert. It re-derives the receipt
          hash byte-exact on your machine (using the release that matches the
          receipt&apos;s methodology version, 0.4.0 onward), and when a receipt carries an
          on-chain anchor it also cross-checks that signer-pinned commitment on
          Solana, so anyone can confirm the published history wasn&apos;t
          altered. Pass <code>--offline</code> for a hash-only check with no RPC
          call. Tamper-evidence, no trust required beyond the open-source code.
        </p>

        <section className="mt-12">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-caption">
            Install
          </h2>
          <div className="mt-3">
            <CodeBlock code={INSTALL_SNIPPET} lang="bash" />
          </div>
          <p className="mt-3 text-[13px] leading-[1.6] text-text-muted">
            The installer detects your platform and downloads the matching
            pre-built binary when one is published for it; otherwise it prints a
            build-from-source fallback (Rust toolchain required).
          </p>
        </section>

        <section className="mt-10">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-caption">
            Verify an alert
          </h2>
          <div className="mt-3">
            <CodeBlock code={VERIFY_SNIPPET} lang="bash" />
          </div>
        </section>

        <section className="mt-10">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-caption">
            Integrity
          </h2>
          <p className="mt-3 text-[13px] leading-[1.6] text-text-muted">
            The installer is plain shell - nothing compiled, nothing obfuscated.
            Read it before piping to sh:
          </p>
          <p className="mt-3 font-mono text-[12px]">
            <a
              className="text-st-pegged underline-offset-2 hover:underline"
              href="/releases/pegana-replay-installer.sh"
            >
              releases.pegana.xyz/pegana-replay-installer.sh
            </a>
          </p>
        </section>

        <footer className="mt-16 border-t border-hairline pt-6 font-mono text-[11px] text-text-caption">
          <p>
            Source:{" "}
            <a
              className="text-text-muted underline-offset-2 hover:text-text hover:underline"
              href="https://github.com/PeganaHQ/ReplayCLI/tree/main/crates/pegana-replay-cli"
              target="_blank"
              rel="noopener noreferrer"
            >
              crates/pegana-replay-cli
            </a>
            <span className="mx-2 text-text-caption/60">·</span>
            <a
              className="text-text-muted underline-offset-2 hover:text-text hover:underline"
              href="/methodology"
            >
              methodology
            </a>
            <span className="mx-2 text-text-caption/60">·</span>
            <a
              className="text-text-muted underline-offset-2 hover:text-text hover:underline"
              href="/audit"
            >
              audit ledger
            </a>
          </p>
        </footer>
      </div>
    </main>
  );
}
