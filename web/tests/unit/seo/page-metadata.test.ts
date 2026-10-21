import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pageMetadata } from "@/lib/seo/page-metadata";

const APP_DIR = join(process.cwd(), "app");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

const APP_FILES = walk(APP_DIR);

describe("pageMetadata", () => {
  it("emits a canonical, an absolute og:url, and a bare title", () => {
    const m = pageMetadata({
      title: "Methodology",
      description: "How Pegana produces peg-risk alerts.",
      path: "/methodology",
    });

    // Bare — the root layout's `template: "%s — Pegana"` appends the brand. A
    // title that already ended in "· Pegana" rendered "… · Pegana — Pegana",
    // which shipped on 8 routes.
    expect(m.title).toBe("Methodology");
    expect(m.alternates?.canonical).toBe("/methodology");
    expect(m.openGraph?.url).toBe("https://www.pegana.xyz/methodology");
    // og:title DOES carry the brand — the template does not apply to OG tags.
    expect((m.openGraph as { title?: string })?.title).toBe(
      "Methodology | Pegana",
    );
    // `Twitter` is a union in Next's types; `card` is not on every member.
    expect((m.twitter as { card?: string })?.card).toBe("summary_large_image");
  });

  it("omits robots unless noindex is explicitly requested", () => {
    expect(
      pageMetadata({ title: "A", description: "d", path: "/a" }).robots,
    ).toBeUndefined();
    expect(
      pageMetadata({ title: "A", description: "d", path: "/a", noindex: true })
        .robots,
    ).toEqual({ index: false, follow: false });
  });
});

describe("app-wide metadata contract", () => {
  /**
   * The root layout sets `title.template = "%s — Pegana"`. Any page title that
   * already contains the brand renders it twice. This shipped on 8 routes
   * ("Events · Pegana — Pegana", "Methodology · Pegana — Pegana", …) and is
   * invisible in code review because each file looks reasonable in isolation.
   */
  it("no page title contains the brand suffix", () => {
    const offenders: string[] = [];
    for (const file of APP_FILES) {
      const src = readFileSync(file, "utf8");
      // `title:` values inside a metadata/pageMetadata block only.
      for (const match of src.matchAll(/^\s*title:\s*(["'`])(.+?)\1/gm)) {
        const value = match[2];
        if (/·\s*Pegana|—\s*Pegana/.test(value)) {
          offenders.push(`${file.replace(process.cwd(), "")}: ${value}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Every route that declares metadata must go through the helper, so it gets a
   * canonical and a per-page `og:url`. Without this, a page setting only
   * `{title, description}` silently inherits the ROOT `openGraph` object —
   * including `url: siteUrl` — and unfurls as the homepage. That is what made
   * every shared audit receipt render the homepage card.
   */
  it("every metadata declaration uses pageMetadata", () => {
    const offenders: string[] = [];
    for (const file of APP_FILES) {
      const src = readFileSync(file, "utf8");
      const declares =
        /export const metadata\b/.test(src) ||
        /export async function generateMetadata\b/.test(src);
      if (!declares) continue;
      // The root layout is the one legitimate exception: it owns the template,
      // the metadataBase and the site-wide OG defaults, and deliberately has no
      // canonical (a hardcoded "/" would canonicalise every page to the homepage).
      if (file.endsWith(join("app", "layout.tsx"))) continue;
      // The global 404 serves every unmatched URL, so it must NOT carry a
      // canonical or og:url (that would point every dead link at one URL). It
      // only sets a title and noindex.
      if (file.endsWith(join("app", "not-found.tsx"))) continue;
      if (!src.includes("pageMetadata")) {
        offenders.push(file.replace(process.cwd(), ""));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("pageMetadata social image", () => {
  it("carries the site card into openGraph and twitter (Next replaces the parent objects wholesale)", () => {
    const m = pageMetadata({
      title: "FAQ",
      description: "Answers.",
      path: "/faq",
    });
    const og = (m.openGraph as { images?: Array<{ url: string; width: number }> })
      .images;
    const tw = (m.twitter as { images?: Array<{ url: string }> }).images;
    expect(og?.[0]?.url).toBe("/opengraph-image.png");
    expect(og?.[0]?.width).toBe(1200);
    expect(tw?.[0]?.url).toBe("/twitter-image.png");
  });
});
