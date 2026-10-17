import fs from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/page-metadata";
import { JsonLd } from "@/components/atoms/json-ld";
import { cn } from "@/lib/utils/cn";
import { switzerV2, geistMonoV2 } from "@/app/fonts/v2-fonts";
import { loadAssetsCanonFromRepo } from "@/lib/asset/canon-server";
import type { CanonAssetMeta } from "@/lib/asset/canon";
import {
  PageHeroV2,
  LiveDot,
} from "@/components/organisms/v2/inner/page-hero-v2";
import { TocRailV2 } from "@/components/organisms/v2/inner/toc-rail-v2";
import { MathObjectV2 } from "@/components/organisms/v2/inner/math-object-v2";
import {
  ListRowsV2,
  ListRow,
} from "@/components/organisms/v2/inner/list-rows-v2";
import { CodeBlockV2 } from "@/components/organisms/v2/inner/code-block-v2";
import { CandorStrikesV2 } from "@/components/organisms/v2/inner/candor-strikes-v2";
import {
  PillPrimary,
  PillGhost,
  StatePillV2,
} from "@/components/organisms/v2/shared";
import type { PegState } from "@/lib/api/types";
import {
  MethodologyChangelog,
  parseEntries,
} from "@/components/molecules/methodology-changelog";
import { AssetsCanon } from "@/components/organisms/assets-canon";

// Trust-Layer v0.1.0 / Wave 11A, re-platformed onto V5 (W2, 2026-07-03).
// Server component, fully static: reads crates/methodology/CHANGELOG.md +
// the canonical assets.toml at build time (both ship to the public
// pegana-replay repo). The asset roster is the live canon the methodology
// crate hashes into every receipt.

export const metadata: Metadata = pageMetadata({
  title: "Methodology",
  description:
    "How Pegana produces peg-risk alerts: deterministic, versioned, replayable. Open-source crate, optional on-chain anchoring, refuse-to-run on broken methodology versions.",
  path: "/methodology",
});

const REPO_ROOT = path.join(process.cwd(), "..");

async function loadChangelog(): Promise<string> {
  try {
    return await fs.readFile(
      path.join(REPO_ROOT, "crates", "methodology", "CHANGELOG.md"),
      "utf-8",
    );
  } catch (err) {
    console.warn("methodology page: changelog unavailable", err);
    return "";
  }
}

type CanonicalAsset = CanonAssetMeta;

async function loadAssetsCanon(): Promise<CanonicalAsset[]> {
  return loadAssetsCanonFromRepo("methodology page");
}

const STATE_ROWS: Array<{ state: PegState; body: string }> = [
  { state: "PEGGED", body: "Spread inside the asset's calibrated drift band." },
  {
    state: "DRIFT",
    body: "Outside the band, inside the depeg line. Watch, don't panic.",
  },
  {
    state: "DEPEG",
    body: "Past the depeg threshold with hysteresis confirming it held.",
  },
  {
    state: "CRITICAL",
    body: "Deep, sustained break. The state nobody wants to receive.",
  },
  {
    state: "UNKNOWN",
    body: "Inputs missing or failing sanity checks. Shown, never hidden.",
  },
];

const VERSION_ROWS = [
  {
    label: "Active",
    color: "var(--v2-peg)",
    body: "Currently emitting receipts. The version the running engine is built against.",
  },
  {
    label: "Deprecated",
    color: "var(--v2-unk)",
    body: "Superseded, still valid. Receipts remain replayable.",
  },
  {
    label: "Broken",
    color: "var(--v2-crit)",
    body: "Bug confirmed post-release. Engine refuses to run it; receipts preserved with a warning.",
  },
];

const VERIFY_CODE = `# install (read the script before piping)
curl --proto '=https' --tlsv1.2 -LsSf \\
  https://releases.pegana.xyz/pegana-replay-installer.sh | sh

# verify an alert: hash + on-chain anchor, both by default
pegana-replay --alert-id <UUID>

# hash-only, no RPC call (CI, air-gapped hosts)
pegana-replay --alert-id <UUID> --offline`;

const TOC = [
  { href: "#m-formula", label: "The formula" },
  { href: "#m-states", label: "Five states" },
  { href: "#m-verify", label: "Verify any alert" },
  { href: "#m-versions", label: "Version states" },
  { href: "#m-canon", label: "The canon" },
  { href: "#m-changelog", label: "Changelog" },
  { href: "#m-not", label: "What this is not" },
];

export default async function MethodologyPage() {
  const [changelog, canon] = await Promise.all([
    loadChangelog(),
    loadAssetsCanon(),
  ]);
  const active = canon.filter((a) => a.active);
  const deferred = canon.filter((a) => !a.active);
  const latest = parseEntries(changelog)[0] ?? null;
  const version = latest?.version ?? null;
  const lastChange = latest?.date ?? null;

  return (
    <main className={cn("pegana-v2", switzerV2.variable, geistMonoV2.variable)}>
      <PageHeroV2
        eyebrow="Methodology"
        h1={
          <>
            Deterministic. Versioned.{" "}
            <span className="v2-iri-text">Replayable.</span>
          </>
        }
        lede={
          <>
            Every Pegana alert is the output of a{" "}
            <b className="font-medium text-[var(--v2-text)]">
              pure function over four inputs
            </b>
            : the asset&apos;s intrinsic value, the executable market quote,
            threshold configuration, and the smoothing state at the moment of
            decision. Same inputs, same verdict, forever.
          </>
        }
        meta={[
          <LiveDot key="v">
            {version
              ? `methodology v${version} · active`
              : "methodology · active"}
          </LiveDot>,
          "open source · crates.io/methodology",
          lastChange ? `last change ${lastChange}` : null,
        ].filter(Boolean)}
      />

      <div className="mx-auto grid max-w-[1180px] grid-cols-1 gap-16 px-5 pb-32 sm:px-8 scene:grid-cols-[200px_minmax(0,1fr)]">
        <TocRailV2 items={TOC} />
        <article className="v2-in-art">
          <div className="v2-in-prose">
            <h2 id="m-formula">The formula</h2>
            <p>
              Peg risk is a distance. Pegana computes what each asset is{" "}
              <b>supposed to be worth</b>, source by source, and compares it to
              what it <b>actually trades at</b> on the best executable route.
              The spread between the two is the whole methodology:
            </p>
          </div>

          <MathObjectV2
            caption="EWMA a = 0.3 smoothing · per-asset thresholds · 30s / 120s hysteresis"
            chips={[
              { label: "intrinsic", value: "on-chain NAV / redemption" },
              { label: "market", value: "best executable quote" },
              { label: "config", value: "assets.toml, hashed" },
              { label: "state", value: "EWMA + hysteresis" },
            ]}
          />

          <div className="v2-in-prose">
            <p>
              Nothing else enters the function. No sentiment, no social signals,
              no manual overrides. When an input is missing or suspect, the
              answer is <b>Unknown</b>, printed in public, never guessed.
            </p>

            <h2 id="m-states">Five states</h2>
            <p>
              The engine classifies every asset into one of five states.
              Direction matters: an LST trading under its stake value is not the
              same event as a stablecoin over its peg.
            </p>
          </div>
          <ListRowsV2 label="Peg state definitions">
            {STATE_ROWS.map((r) => (
              <ListRow key={r.state} columns="130px 1fr">
                <StatePillV2 state={r.state} />
                <span className="text-[14.5px] text-[var(--v2-body)]">
                  {r.body}
                </span>
              </ListRow>
            ))}
          </ListRowsV2>
          <div className="v2-in-prose">
            <p>
              Transitions are debounced by a Schmitt-trigger deadband so one bad
              quote can&apos;t flap a state, and every yield-bearing premium
              passes a NAV-sanity guard before it can print a confident verdict.
            </p>

            <h2 id="m-verify">Verify any alert</h2>
            <p>
              The verifier is a self-hosted CLI that ships a SHA-256-pinned
              binary via a Sigstore attestation. Point it at any alert ID and,
              by default, it recomputes the receipt hash AND cross-checks the
              on-chain anchor (add <code>--offline</code> to skip the on-chain
              step and stay hash-only):
            </p>
          </div>
          <CodeBlockV2 label="verify.sh" code={VERIFY_CODE} />
          <div className="v2-in-prose">
            <p>
              Replay is <b>byte-exact or it fails loudly</b>. If the recomputed
              receipt hash differs from the published one, the alert does not
              verify, and that is the point.
            </p>

            <h2 id="m-versions">A version has three states</h2>
            <p>
              The engine refuses to start on a broken version. Past receipts
              from broken versions stay queryable and replayable, but render a
              warning.
            </p>
          </div>
          <ListRowsV2 label="Methodology version states">
            {VERSION_ROWS.map((r) => (
              <ListRow key={r.label} columns="150px 1fr">
                <span
                  className="inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px]"
                  style={{
                    color: r.color,
                    borderColor: `color-mix(in srgb, ${r.color} 38%, transparent)`,
                  }}
                >
                  <i
                    aria-hidden
                    className="h-[5px] w-[5px] rounded-full"
                    style={{ background: "currentColor" }}
                  />
                  {r.label}
                </span>
                <span className="text-[14.5px] text-[var(--v2-body)]">
                  {r.body}
                </span>
              </ListRow>
            ))}
          </ListRowsV2>

          <div className="v2-in-prose">
            <h2 id="m-canon">The canon, hashed into every receipt</h2>
            <p>
              Every receipt hashes the canonical <code>assets.toml</code> as
              part of its inputs. Replay still works against historical receipts
              because each one embeds the canon it was produced under.{" "}
              {canon.length > 0 && (
                <>
                  {active.length} active assets across{" "}
                  {new Set(active.map((a) => a.className)).size} classes:
                </>
              )}
            </p>
          </div>
          {canon.length === 0 ? (
            <p className="font-mono text-[13px] text-[var(--v2-muted)]">
              Could not read assets.toml at build time.
            </p>
          ) : (
            <AssetsCanon assets={active} />
          )}
          {deferred.length > 0 && (
            <p className="mt-3 font-mono text-[12px] text-[var(--v2-dim)]">
              plus {deferred.length} symbol{deferred.length === 1 ? "" : "s"}{" "}
              kept in the canon but currently inactive:{" "}
              {deferred.map((a) => a.symbol).join(", ")}
            </p>
          )}

          <div className="v2-in-prose">
            <h2 id="m-changelog">Methodology changelog</h2>
            <p>
              Rendered at build time from{" "}
              <code>crates/methodology/CHANGELOG.md</code>. Behavior changes
              only; the full diff lives in the public repo.
            </p>
          </div>
          <MethodologyChangelog raw={changelog} />

          <div className="v2-in-prose">
            <h2 id="m-not">What this is not</h2>
          </div>
          <CandorStrikesV2
            rows={[
              {
                no: "SOC 2 compliance.",
                yes: "Pegana's audit log is a verifiable computation log: anyone can prove which methodology produced which alert, given which inputs.",
              },
              {
                no: "A regulatory audit.",
                yes: "Use it to verify our claims. Don't substitute it for your own judgment.",
              },
              {
                no: "Financial advice.",
                yes: "Pegana measures distance. What you do with the measurement is yours.",
              },
            ]}
          />

          <div className="mt-14 flex flex-wrap gap-3.5">
            <PillPrimary href="/audit">Verify an alert</PillPrimary>
            <PillGhost href="/audit">Browse audits</PillGhost>
          </div>
        </article>
      </div>

      {/*
        Dataset is the one schema.org type that describes this product literally
        rather than by analogy: Pegana publishes a continuously-updated,
        openly-readable dataset of peg-state classifications with a documented
        methodology. It is also what makes the corpus eligible for Google
        Dataset Search, a surface a risk analyst plausibly uses and a generic
        SoftwareApplication entity cannot reach.

        Declared here, on the page that documents the methodology, rather than
        sitewide — a Dataset entity on every route would describe the marketing
        pages as data, which they are not.
      */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Dataset",
          name: "Pegana peg-risk state dataset",
          description:
            "Continuously updated peg-state classifications (PEGGED, DRIFT, DEPEG, CRITICAL, BLACK_SWAN, UNKNOWN) for Solana stablecoins, liquid staking tokens, CDP-backed, yield-bearing, FX-referenced and leveraged synthetic assets. Each state change emits a hash-verifiable receipt that can be re-derived offline from the open-source methodology crate.",
          url: "https://www.pegana.xyz/methodology",
          isAccessibleForFree: true,
          creator: {
            "@type": "Organization",
            name: "PeganaHQ",
            url: "https://www.pegana.xyz",
          },
          variableMeasured: [
            "intrinsic value",
            "market value",
            "discount",
            "peg state",
            "collateral ratio",
          ],
          distribution: [
            {
              "@type": "DataDownload",
              encodingFormat: "application/json",
              contentUrl: "https://api.pegana.xyz/v1/assets",
            },
            {
              "@type": "DataDownload",
              encodingFormat: "text/csv",
              contentUrl: "https://api.pegana.xyz/v1/audit.csv",
            },
            {
              "@type": "DataDownload",
              encodingFormat: "application/atom+xml",
              contentUrl: "https://www.pegana.xyz/audit.xml",
            },
          ],
        }}
      />
    </main>
  );
}
