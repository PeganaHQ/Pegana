// Wave 11M.6 — /calibration.xml Atom 1.0 feed of methodology + assets.toml
// mutations.
//
// Two streams merged into one feed:
//   1. crates/methodology/CHANGELOG.md — one <entry> per version section.
//   2. git log of assets.toml — one <entry> per commit (threshold or asset
//      add/remove changes).
//
// Subscribers (auditors, researchers) get a single subscription that fires
// whenever the methodology version bumps OR the asset table mutates.
//
// Build-time fs + git access mirrors /methodology page (Wave 11A). Graceful
// degradation: if CHANGELOG or git is missing (e.g. minimal Docker), the
// feed still renders with whatever is reachable.

import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { siteOrigin } from "@/lib/seo/site-origin";

export const revalidate = 3600;

const SITE_URL = siteOrigin();
const REPO_ROOT = path.join(process.cwd(), "..");

function xmlEscape(s: string): string {
  return s.replace(
    /[<>&'"]/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      })[c] ?? c,
  );
}

interface CalibrationEntry {
  id: string;
  title: string;
  link: string;
  updated: string; // ISO
  body: string;
  kind: "methodology" | "assets";
}

async function loadMethodologyEntries(): Promise<CalibrationEntry[]> {
  try {
    const raw = await fs.readFile(
      path.join(REPO_ROOT, "crates", "methodology", "CHANGELOG.md"),
      "utf-8",
    );
    const entries: CalibrationEntry[] = [];
    // Split on `## <version> — <date>` headers.
    const sectionRe = /^##\s+([^\s\u2014-]+)\s*[\u2014-]\s*(\d{4}-\d{2}-\d{2})\s*$/gm;
    const matches = [...raw.matchAll(sectionRe)];
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      if (!m) continue;
      const version = m[1] ?? "";
      const date = m[2] ?? "";
      const start = (m.index ?? 0) + m[0].length;
      const nextMatch = matches[i + 1];
      const end =
        nextMatch && nextMatch.index != null ? nextMatch.index : raw.length;
      const body = raw.slice(start, end).trim();
      entries.push({
        id: `${SITE_URL}/methodology#changelog-v${version}`,
        title: `Methodology v${version} released`,
        link: `${SITE_URL}/methodology#changelog`,
        updated: new Date(`${date}T00:00:00Z`).toISOString(),
        body,
        kind: "methodology",
      });
    }
    return entries;
  } catch (err) {
    console.warn("calibration.xml: methodology changelog unavailable", err);
    return [];
  }
}

function loadAssetsEntries(limit: number): CalibrationEntry[] {
  try {
    const raw = execSync(
      `git log --follow --pretty=format:%H|%aI|%s --date=iso-strict -n ${limit} -- assets.toml`,
      {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line): CalibrationEntry | null => {
        const [sha = "", dateIso = "", ...subjectParts] = line.split("|");
        if (!sha) return null;
        const subject = subjectParts.join("|");
        return {
          id: `${SITE_URL}/methodology#assets-${sha}`,
          title: `Assets snapshot updated: ${subject}`,
          link: `https://github.com/PeganaHQ/ReplayCLI/commit/${sha}`,
          updated: new Date(dateIso).toISOString(),
          body: `Commit ${sha.slice(0, 7)}: ${subject}`,
          kind: "assets",
        };
      })
      .filter((e): e is CalibrationEntry => e !== null);
  } catch (err) {
    console.warn("calibration.xml: assets git log unavailable", err);
    return [];
  }
}

function entryXml(e: CalibrationEntry): string {
  return `
  <entry>
    <id>${xmlEscape(e.id)}</id>
    <title>${xmlEscape(e.title)}</title>
    <link href="${xmlEscape(e.link)}" />
    <updated>${e.updated}</updated>
    <category term="${e.kind}" />
    <summary>${xmlEscape(e.body)}</summary>
  </entry>`;
}

export async function GET() {
  const [methodology, assets] = [
    await loadMethodologyEntries(),
    loadAssetsEntries(100),
  ];
  const all = [...methodology, ...assets].sort((a, b) =>
    a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0,
  );
  const updated = all[0]?.updated ?? new Date().toISOString();

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Pegana. Calibration Changes</title>
  <subtitle>Methodology releases and asset configuration mutations.</subtitle>
  <link href="${xmlEscape(SITE_URL)}" />
  <link href="${xmlEscape(SITE_URL)}/calibration.xml" rel="self" type="application/atom+xml" />
  <id>${xmlEscape(SITE_URL)}/calibration</id>
  <icon>${xmlEscape(SITE_URL)}/favicon.ico</icon>
  <updated>${updated}</updated>
  <author>
    <name>Pegana</name>
    <uri>${xmlEscape(SITE_URL)}</uri>
  </author>
  <rights>© ${new Date().getUTCFullYear()} Pegana</rights>${all.map(entryXml).join("")}
</feed>
`;

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=60",
    },
  });
}
