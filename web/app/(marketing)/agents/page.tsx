import fs from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/page-metadata";
import { cn } from "@/lib/utils/cn";
import { switzerV2, geistMonoV2 } from "@/app/fonts/v2-fonts";
import { PageHeroV2 } from "@/components/organisms/v2/inner/page-hero-v2";
import { CodeBlockV2 } from "@/components/organisms/v2/inner/code-block-v2";
import { PillPrimary, PillGhost } from "@/components/organisms/v2/shared";
import { latestVersion } from "@/components/molecules/methodology-changelog";
import { AgentTabs } from "./agent-tabs";

// /agents — landing for agent integrators. Pitches verifiable peg-state in the
// prompt, an audit URL in the decision log, and no API keys. Every MCP tool is
// free. Re-platformed onto V5 (W2, 2026-07-03): the three capabilities are
// tabbed code panes (verify_alert / subscribe / REST) instead of stacked cards,
// matching the approved artifact.

export const metadata: Metadata = pageMetadata({
  title: "Agents",
  description:
    "Verifiable peg-state for AI agents. MCP server, REST API, every signal carries an audit URL.",
  path: "/agents",
});

const MCP_URL = "https://mcp.pegana.xyz";
const REST_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "https://api.pegana.xyz";
// The Atom feed lives on the marketing origin, not the api.* subdomain. Hardcoded
// so the copy/paste example never reflects a dev env's localhost.
const PUBLIC_FEED = "https://www.pegana.xyz/audit.xml";

const REPO_ROOT = path.join(process.cwd(), "..");

async function loadMethodologyVersion(): Promise<string | null> {
  try {
    const raw = await fs.readFile(
      path.join(REPO_ROOT, "crates", "methodology", "CHANGELOG.md"),
      "utf-8",
    );
    return latestVersion(raw);
  } catch {
    return null;
  }
}

const VERIFY_CODE = `const receipt = await mcp.callTool("verify_alert", {
  alert_id: alertUuid,
});

const { evidence } = receipt.structuredContent;
console.log("methodology:", evidence.methodology_version);
console.log("receipt sha256:", evidence.receipt_sha256);
console.log("on-chain:", evidence.onchain_tx_sig ?? "pending");`;

const SUBSCRIBE_CODE = `const events = await mcp.callTool("subscribe_peg_events", {
  symbols: ["USDe", "PYUSD", "USDS"],
  since_ts: lastCursor,
  threshold_bps: 50,
});

for (const e of events.structuredContent.events) {
  if (e.to_state === "DRIFT" || e.to_state === "DEPEG") {
    await haltAllocation(e.asset); // cite e.evidence_url
  }
}`;

const REST_CODE = `curl -s ${REST_BASE}/v1/audit/<UUID> | jq .

# Atom feed of recent alerts
curl -s ${PUBLIC_FEED}`;

const MCP_CODE = `${MCP_URL}

# liveness  GET ${MCP_URL}/health
# metrics   GET ${MCP_URL}/metrics`;

export default async function AgentsPage() {
  const version = await loadMethodologyVersion();

  return (
    <main className={cn("pegana-v2", switzerV2.variable, geistMonoV2.variable)}>
      <PageHeroV2
        eyebrow="For agents"
        h1="Verifiable peg state in your prompts."
        maxWidthCh={22}
        lede={
          <>
            Pegana exposes peg-risk signals to AI agents over{" "}
            <b className="font-medium text-[var(--v2-text)]">
              Model Context Protocol
            </b>{" "}
            and REST. Subscribe to live state transitions, verify any
            alert&apos;s provenance, and cite receipts in the decision log.{" "}
            <b className="font-medium text-[var(--v2-text)]">No API keys.</b>{" "}
            Every tool is free.
          </>
        }
        meta={[
          version ? `methodology v${version}` : "methodology",
          "receipt v1",
          "sigstore",
          "free",
        ]}
      />

      <div className="mx-auto max-w-[880px] px-5 pb-32 sm:px-8">
        <h2 className="mb-2 max-w-[24ch] text-[26px] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--v2-text)]">
          Agents that act on financial signals must cite why they acted.
        </h2>
        <p className="v2-in-prose max-w-[640px]">
          Every Pegana signal carries an <code>evidence_url</code> and a{" "}
          <code>receipt_sha256</code>: a citable, verifiable record of every
          decision input, reproducible offline via <code>pegana-replay</code>.
          Severe transitions can additionally carry an on-chain anchor, a
          Solana SPL Memo commitment.
        </p>

        <AgentTabs
          tabs={[
            {
              id: "verify",
              label: "verify_alert · free",
              pane: <CodeBlockV2 label="verify_alert.ts" code={VERIFY_CODE} />,
            },
            {
              id: "subscribe",
              label: "subscribe · free",
              pane: (
                <CodeBlockV2
                  label="subscribe_peg_events.ts"
                  code={SUBSCRIBE_CODE}
                />
              ),
            },
            {
              id: "rest",
              label: "REST · no client",
              pane: <CodeBlockV2 label="audit.sh" code={REST_CODE} />,
            },
          ]}
        />

        <div className="mt-11 flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-[var(--v2-line)] bg-[var(--v2-panel)] p-6">
          <p className="max-w-[52ch] text-[15px] leading-[1.65] text-[var(--v2-body)]">
            Every MCP tool is{" "}
            <b className="font-medium text-[var(--v2-text)]">free</b>. No keys,
            no signup, no payment. Rate-limited per IP so one agent cannot
            starve the rest.
          </p>
          <div className="flex flex-wrap gap-2.5">
            <PillPrimary href="#endpoint">Get the endpoint</PillPrimary>
            <PillGhost href="/methodology#m-verify">How to verify</PillGhost>
            {/* #embedlab: the embeddable badge playground. It ships but is a
                secondary integration surface, so it is linked contextually
                here rather than taking one of the footer's slots. */}
            <PillGhost href="/embed">Embed the badge</PillGhost>
          </div>
        </div>

        <hr className="v2-in-hr" />
        <h2
          id="endpoint"
          className="mb-1.5 text-[26px] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--v2-text)]"
        >
          Point your client here.
        </h2>
        <p className="v2-in-prose max-w-[640px]">
          There&apos;s no browser UI. The server speaks JSON-RPC over POST; copy
          the endpoint into your MCP client.
        </p>
        <CodeBlockV2 label="mcp endpoint" code={MCP_CODE} />
        <p className="font-mono text-[11.5px] text-[var(--v2-dim)]">
          Pegana is a verifiable computation log. Not SOC 2, not a regulatory
          audit, not financial advice.
        </p>
      </div>
    </main>
  );
}
