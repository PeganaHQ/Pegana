import React from "react";
import {
  TimelineV2,
  TimelineItemV2,
  TypePillV2,
} from "@/components/organisms/v2/inner/timeline-v2";

// Parses crates/methodology/CHANGELOG.md into a versioned timeline (V5 W2,
// 2026-07-03 — was card-per-version before, now TimelineV2 to match the
// approved artifact). Server component — no hooks, runs at build time
// alongside the page's fs read.
//
// Format: `## <version> — <date>` headers, then prose paragraphs + `- `
// bullets, with `**bold**` and `` `code` `` inline. No italic is ever
// rendered (brand bans it) — `*emph*` markers are stripped to plain weight.
// The source file's own prose uses real em-dashes (it's methodology-crate
// changelog copy, not site chrome) — `stripDashes` swaps them for a plain
// hyphen at render time only, so the *page* never shows one, without
// touching the underlying CHANGELOG.md.

export interface Entry {
  version: string;
  date: string;
  body: string[];
}

export function parseEntries(raw: string): Entry[] {
  const entries: Entry[] = [];
  let cur: Entry | null = null;
  for (const line of raw.split("\n")) {
    const h = line.match(/^##\s+(.+)$/);
    if (h) {
      if (cur) entries.push(cur);
      const [version, date] = h[1].split(/[\u2014\u2013]/).map((s) => s.trim());
      cur = { version: version ?? h[1].trim(), date: date ?? "", body: [] };
      continue;
    }
    if (cur) cur.body.push(line);
  }
  if (cur) entries.push(cur);
  return entries;
}

/** The version the running engine is built against — the newest entry in the
 *  file. Used by the methodology page hero meta row. */
export function latestVersion(raw: string): string | null {
  return parseEntries(raw)[0]?.version ?? null;
}

function stripDashes(s: string): string {
  return s.replace(/[\u2014\u2013]/g, "-");
}

function stripEmph(s: string): string {
  return stripDashes(s.replace(/(\*|_)(?=\S)([^*_]+)\1/g, "$2"));
}

function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(stripEmph(text.slice(last, m.index)));
    const tok = m[0];
    if (tok.startsWith("**")) {
      out.push(
        <b key={`${keyBase}-b${i++}`}>{stripDashes(tok.slice(2, -2))}</b>,
      );
    } else {
      out.push(
        // overflow-wrap:anywhere lets long identifiers such as
        // discount_sanity_violated break instead of running off a 390 screen.
        <code key={`${keyBase}-c${i++}`} className="[overflow-wrap:anywhere]">
          {stripDashes(tok.slice(1, -1))}
        </code>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(stripEmph(text.slice(last)));
  return out;
}

function renderBody(body: string[], keyBase: string): React.ReactNode[] {
  const blocks: React.ReactNode[] = [];
  let para: string[] = [];
  let bullets: string[] = [];
  let k = 0;

  const flushPara = () => {
    if (para.length) {
      blocks.push(
        <p key={`${keyBase}-p${k++}`}>
          {inline(para.join(" "), `${keyBase}-p${k}`)}
        </p>,
      );
      para = [];
    }
  };
  const flushBullets = () => {
    if (bullets.length) {
      blocks.push(
        <ul key={`${keyBase}-u${k++}`}>
          {bullets.map((b, bi) => (
            <li key={bi}>{inline(b, `${keyBase}-u${k}-${bi}`)}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };

  for (const rawLine of body) {
    const t = rawLine.trim();
    const isBullet = /^[-*]\s+/.test(t);
    const indented = /^\s/.test(rawLine) && t.length > 0;
    if (t === "") {
      flushPara();
      flushBullets();
    } else if (isBullet) {
      flushPara();
      bullets.push(t.replace(/^[-*]\s+/, ""));
    } else if (indented && bullets.length > 0) {
      bullets[bullets.length - 1] += " " + t;
    } else {
      flushBullets();
      para.push(t);
    }
  }
  flushPara();
  flushBullets();
  return blocks;
}

export function MethodologyChangelog({ raw }: { raw: string }) {
  const entries = parseEntries(raw);
  if (entries.length === 0) {
    return (
      <div className="v2-in-lrows">
        <div className="v2-in-lrow" style={{ gridTemplateColumns: "1fr" }}>
          <span style={{ color: "var(--v2-muted)" }}>
            Changelog unavailable at build time.
          </span>
        </div>
      </div>
    );
  }
  return (
    <TimelineV2>
      {entries.map((e, i) => (
        <TimelineItemV2
          key={e.version}
          hot={i === 0}
          meta={
            <>
              <span>v{e.version}</span>
              {e.date && <span>{e.date}</span>}
              <TypePillV2 color={i === 0 ? "var(--v2-peg)" : "var(--v2-unk)"}>
                {i === 0 ? "Active" : "Deprecated"}
              </TypePillV2>
            </>
          }
        >
          <div className="v2-in-prose">{renderBody(e.body, e.version)}</div>
        </TimelineItemV2>
      ))}
    </TimelineV2>
  );
}
