// Page-integrity guard.
//
// The free-release cleanup removed several surfaces (/sign-in, /account,
// /pricing, /auth/magic) and moved others around. A link to a removed page is
// invisible to typecheck and to a render test — it just 404s in production.
// This guard makes that class of regression fail CI:
//
//   1. the required pages must exist on disk,
//   2. the removed pages must NOT exist,
//   3. every internal href in app/, components/ and lib/ must resolve to a
//      route that actually ships.
//
// It is falsifiable by construction: `resolvesHref` is exercised directly
// against known-bad hrefs below, so a bug that makes every href "resolve"
// fails the suite.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const APP = join(ROOT, "app");

// ── route discovery ────────────────────────────────────────────────────────

/** Convert an app-router file path into the URL template it serves. */
function routeFromFile(file: string): string | null {
  const rel = relative(APP, file).split(sep).join("/");
  const base = rel.replace(/\.(tsx|ts|mdx)$/, "");
  if (!/(^|\/)(page|route)$/.test(base)) return null;

  const segments = base
    .split("/")
    .slice(0, -1) // drop "page" / "route"
    .filter((s) => !/^\(.*\)$/.test(s)); // drop route groups

  return "/" + segments.join("/");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const LIVE_ROUTES = new Set(
  walk(APP)
    .map(routeFromFile)
    .filter((r): r is string => r !== null)
    .map((r) => (r === "" ? "/" : r)),
);

// Static files under public/ are real, servable destinations too
// (e.g. /releases/pegana-replay-installer.sh).
const PUBLIC_FILES = new Set(
  walk(join(ROOT, "public")).map(
    (f) => "/" + relative(join(ROOT, "public"), f).split(sep).join("/"),
  ),
);

// ── href resolution ────────────────────────────────────────────────────────

function stripHref(raw: string): string | null {
  let href = raw.trim();
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  href = href.split("#")[0].split("?")[0];
  return href === "" ? "/" : href;
}

function segments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

function matchesTemplate(href: string, template: string): boolean {
  const h = segments(href);
  const t = segments(template);
  for (let i = 0; i < t.length; i += 1) {
    const part = t[i]!;
    if (part.startsWith("[") && part.endsWith("]")) {
      // Dynamic segment: one path piece (catch-all takes the rest).
      if (part.startsWith("[...")) return true;
      if (h[i] === undefined) return false;
      continue;
    }
    if (part !== h[i]) return false;
  }
  return h.length === t.length;
}

/** True when an absolute, internal href resolves to a shipped route. */
export function resolvesHref(href: string): boolean {
  const path = stripHref(href);
  if (path === null) return true; // external / anchor / mailto
  if (PUBLIC_FILES.has(path)) return true;
  for (const route of LIVE_ROUTES) {
    if (matchesTemplate(path, route)) return true;
  }
  return false;
}

// ── source scan ────────────────────────────────────────────────────────────

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/([^:])\/\/.*$/gm, "$1");
}

function sourceFiles(): string[] {
  return ["app", "components", "lib"].flatMap((dir) =>
    walk(join(ROOT, dir)).filter(
      (f) =>
        (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.includes(".test."),
    ),
  );
}

/** Literal internal hrefs only. Template expressions are resolved by prefix. */
function hrefsIn(src: string): string[] {
  const code = stripComments(src);
  const found: string[] = [];
  for (const m of code.matchAll(/href\s*=\s*"(\/[^"]*)"/g)) found.push(m[1]!);
  for (const m of code.matchAll(/href\s*=\s*\{\s*"(\/[^"]*)"\s*\}/g))
    found.push(m[1]!);
  // Template literals: keep the static prefix before `${`.
  for (const m of code.matchAll(/href\s*=\s*\{\s*`(\/[^`$]*)/g))
    found.push(`${m[1]!}__dynamic__`);
  return found;
}

function hrefResolvesWithPrefix(href: string): boolean {
  if (!href.endsWith("__dynamic__")) return resolvesHref(href);
  const prefix = href.slice(0, -"__dynamic__".length);
  // A dynamic href is fine when a route exists under its static prefix.
  const prefixSegs = segments(stripHref(prefix) ?? "/");
  for (const route of LIVE_ROUTES) {
    const rs = segments(route);
    if (rs.length < prefixSegs.length) continue;
    const ok = prefixSegs.every(
      (s, i) => s === rs[i] || (rs[i]!.startsWith("[") && rs[i]!.endsWith("]")),
    );
    if (ok) return true;
  }
  return false;
}

// ── tests ──────────────────────────────────────────────────────────────────

const REQUIRED_ROUTES = [
  // marketing
  "/",
  "/about",
  "/agents",
  "/audit",
  "/backtest",
  "/embed",
  "/faq",
  "/live",
  "/lst",
  "/methodology",
  "/privacy",
  "/releases",
  "/status",
  "/terms",
  "/whats-new",
  // product (now public)
  "/dashboard",
  "/assets",
  "/asset/[symbol]",
  "/compare",
  "/heatmap",
  "/events",
  "/systemic",
  // infrastructure
  "/offline",
] as const;

const REMOVED_ROUTES = [
  "/sign-in",
  "/account",
  "/account/alerts",
  "/account/api-keys",
  "/account/settings",
  "/account/subscriptions",
  "/account/webhooks",
  "/auth/magic",
  "/pricing",
] as const;

describe("live route inventory", () => {
  it("ships every required page", () => {
    for (const route of REQUIRED_ROUTES) {
      expect(LIVE_ROUTES.has(route), `${route} is missing`).toBe(true);
    }
  });

  it("does not ship any removed page", () => {
    for (const route of REMOVED_ROUTES) {
      expect(LIVE_ROUTES.has(route), `${route} still ships`).toBe(false);
    }
  });

  it("still discovers a healthy number of routes", () => {
    expect(LIVE_ROUTES.size).toBeGreaterThan(20);
  });
});

describe("internal links resolve", () => {
  it("resolver accepts a real page and a dynamic detail route", () => {
    expect(resolvesHref("/dashboard")).toBe(true);
    expect(resolvesHref("/asset/jitoSOL")).toBe(true);
    expect(resolvesHref("/status?x=1#top")).toBe(true);
  });

  it("resolver rejects removed pages (falsifiability check)", () => {
    for (const dead of ["/sign-in", "/account", "/pricing", "/auth/magic"]) {
      expect(resolvesHref(dead), `${dead} should not resolve`).toBe(false);
    }
    expect(resolvesHref("/definitely-not-a-page")).toBe(false);
  });

  it("every literal internal href in app/, components/ and lib/ resolves", () => {
    const broken: string[] = [];
    for (const file of sourceFiles()) {
      const src = readFileSync(file, "utf8");
      for (const href of hrefsIn(src)) {
        if (!hrefResolvesWithPrefix(href)) {
          broken.push(`${relative(ROOT, file)} -> ${href}`);
        }
      }
    }
    expect(broken, `dead internal links:\n${broken.join("\n")}`).toEqual([]);
  });
});
