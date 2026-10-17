export type ChangelogTag = "FEATURE" | "FIX" | "INTERNAL";

export interface RecentCommit {
  date: string;
  tag: ChangelogTag;
  blurb: string;
  url: string;
  sha: string;
}

// PUBLIC mirror repo — unauthenticated api.github.com reads succeed here. The
// private `lrafasouza/pegana` 404s without a token, which silently collapsed
// the /about "recently shipped" strip to a single fallback row. The page copy +
// footer already link to pegana-replay; the fetcher now agrees.
const REPO = "PeganaHQ/ReplayCLI";
const SKIP_TYPES_STRICT = new Set([
  "style",
  "chore",
  "ci",
  "docs",
  "build",
  "test",
]);
/** Subtree-mirror plumbing — the public repo is a sync target, so its history
 *  is dominated by identical `sync: mirror …` commits. Never product changes. */
const SKIP_SUBJECTS = /^sync:\s/i;

const FALLBACK: RecentCommit[] = [
  {
    date: "2026-05-24",
    tag: "FEATURE",
    blurb:
      "Inner-pages wave shipping: methodology TOC, status histogram, events heatmap, embed specimen, learn 4-up grid.",
    url: `https://github.com/${REPO}/commits/main`,
    sha: "-",
  },
];

interface GithubCommit {
  sha: string;
  html_url: string;
  commit: { message: string; author: { date: string } };
}

interface ParseResult {
  tag: ChangelogTag;
  blurb: string;
  scope: string | null;
}

function parseCommit(message: string): ParseResult & { type: string | null } {
  const firstLine = message.split("\n", 1)[0]?.trim() ?? "";
  const match = firstLine.match(/^([a-z]+)(?:\(([^)]+)\))?!?:\s*(.+)$/i);
  if (!match)
    return { tag: "INTERNAL", blurb: firstLine, scope: null, type: null };
  const type = match[1].toLowerCase();
  const scope = match[2] ?? null;
  const body = match[3].trim();
  let tag: ChangelogTag;
  if (type === "feat") tag = "FEATURE";
  else if (type === "fix" || type === "perf") tag = "FIX";
  else tag = "INTERNAL";
  return { tag, blurb: body, scope, type };
}

export async function getRecentCommits(limit = 3): Promise<RecentCommit[]> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/commits?per_page=20`,
      {
        next: { revalidate: 600, tags: ["github-commits"] },
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!res.ok) return FALLBACK;
    const raw = (await res.json()) as GithubCommit[];
    const out: RecentCommit[] = [];
    for (const c of raw) {
      if (SKIP_SUBJECTS.test(c.commit.message.trimStart())) continue;
      const parsed = parseCommit(c.commit.message);
      if (parsed.type && SKIP_TYPES_STRICT.has(parsed.type)) continue;
      if (out.length > 0 && out[out.length - 1].blurb === parsed.blurb)
        continue;
      out.push({
        date: c.commit.author.date.slice(0, 10),
        tag: parsed.tag,
        blurb: parsed.blurb,
        url: c.html_url,
        sha: c.sha.slice(0, 7),
      });
      if (out.length >= limit) break;
    }
    return out.length > 0 ? out : FALLBACK;
  } catch {
    return FALLBACK;
  }
}
