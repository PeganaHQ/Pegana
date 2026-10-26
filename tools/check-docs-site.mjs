#!/usr/bin/env node
// check-docs-site.mjs: static gate for the Mintlify docs in docs-site/.
//
// WHY THIS EXISTS
//   Mintlify keeps serving the LAST GOOD build of a page whose MDX fails to
//   parse, with no visible error. A single `<1s` in changelog.mdx (read by MDX
//   as the start of a JSX tag) froze the live changelog for three months.
//   This script fails CI instead:
//     1. every .mdx page compiles with @mdx-js/mdx (+ remark-gfm, as Mintlify);
//     2. docs.json is valid JSON and every navigation page exists on disk;
//     3. every root-relative internal link (/guides/x, /guides/x#anchor)
//        points at an existing page.
//   Anchors are not checked: Mintlify's slug rules are not documented and the
//   live ids are the only source of truth for them.
//
// USAGE
//   node tools/check-docs-site.mjs docs-site
//   Needs @mdx-js/mdx and remark-gfm resolvable from the script's directory or
//   the current working directory (CI installs them into a temp prefix and
//   copies this script there).

import fs from "node:fs";
import path from "node:path";
import { compile } from "@mdx-js/mdx";
import remarkGfm from "remark-gfm";

const root = path.resolve(process.argv[2] ?? "docs-site");
const failures = [];

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".mdx")) out.push(p);
  }
  return out;
}

function stripFrontmatter(src) {
  return src.replace(/^---\n[\s\S]*?\n---\n/, "");
}

const pages = walk(root);
const pageIds = new Set(
  pages.map((p) => path.relative(root, p).replace(/\\/g, "/").replace(/\.mdx$/, "")),
);

// 1. MDX compile.
for (const p of pages) {
  const rel = path.relative(root, p);
  try {
    await compile(stripFrontmatter(fs.readFileSync(p, "utf8")), {
      remarkPlugins: [remarkGfm],
    });
  } catch (err) {
    const where = err.line ? `:${err.line}:${err.column ?? 0}` : "";
    failures.push(`MDX compile failed: ${rel}${where}: ${err.reason ?? err.message}`);
  }
}

// 2. docs.json validity + navigation targets.
let docsJson;
try {
  docsJson = JSON.parse(fs.readFileSync(path.join(root, "docs.json"), "utf8"));
} catch (err) {
  failures.push(`docs.json is not valid JSON: ${err.message}`);
}
function navPages(node, acc = []) {
  if (typeof node === "string") acc.push(node);
  else if (Array.isArray(node)) node.forEach((n) => navPages(n, acc));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "pages" || k === "groups" || k === "tabs") navPages(v, acc);
    }
  }
  return acc;
}
if (docsJson) {
  for (const id of navPages(docsJson.navigation ?? {})) {
    if (!pageIds.has(id)) failures.push(`docs.json navigation points at a missing page: ${id}`);
  }
}

// 3. Root-relative internal links.
const linkRe = /\]\((\/[^)\s#]*)(#[^)\s]*)?\)|href="(\/[^"#]*)(#[^"]*)?"/g;
for (const p of pages) {
  const rel = path.relative(root, p);
  const src = stripFrontmatter(fs.readFileSync(p, "utf8"));
  for (const m of src.matchAll(linkRe)) {
    const target = (m[1] ?? m[3]).replace(/^\//, "").replace(/\/$/, "");
    if (target === "" || target.startsWith("images/") || target.startsWith("logo/")) continue;
    if (!pageIds.has(target)) failures.push(`broken internal link in ${rel}: /${target}`);
  }
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  console.error(`\n${failures.length} docs-site problem(s).`);
  process.exit(1);
}
console.log(`docs-site OK: ${pages.length} pages compile, docs.json valid, internal links resolve.`);
