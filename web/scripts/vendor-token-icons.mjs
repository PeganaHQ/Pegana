#!/usr/bin/env node
// Build-time token-icon vendoring. Reads assets.toml, resolves each mint's logo
// through override -> Jupiter Token API v2, downloads + normalizes to a 96x96
// WebP under public/tokens/{mint}.webp, and writes a provenance manifest.json.
// Re-run with `bun run icons:sync` when assets change. Output is committed, so
// production never hits the network to render an icon.
//
// NOTE: this script's `sharp` (^0.35) is a top-level devDependency, independent
// of the `sharp` that Next.js pins internally for its image optimizer. Both can
// coexist; if you bump one, you do not have to bump the other.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(__dirname, "..", "..");
const OUT_DIR = join(WEB_ROOT, "public", "tokens");
const ASSETS_TOML = join(REPO_ROOT, "assets.toml");
const OVERRIDES = join(WEB_ROOT, "lib", "token-icons", "overrides.json");
const SIZE = 96;

const JUP_KEY = process.env.JUP_API_KEY || process.env.JUPITER_API_KEY || "";
const JUP_BASE = JUP_KEY ? "https://api.jup.ag" : "https://lite-api.jup.ag";

async function jupiterIcons(mints) {
  // v2 search accepts up to 100 comma-separated mints per call.
  const url = `${JUP_BASE}/tokens/v2/search?query=${mints.join(",")}`;
  const res = await fetch(url, { headers: JUP_KEY ? { "x-api-key": JUP_KEY } : {} });
  if (!res.ok) throw new Error(`Jupiter HTTP ${res.status}`);
  const arr = await res.json();
  const map = new Map();
  for (const t of arr) {
    const id = t.id || t.address;
    if (id && t.icon) map.set(id, t.icon);
  }
  return map;
}

async function fetchBytes(url) {
  if (url.startsWith("file:")) return readFileSync(url.slice("file:".length));
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const toml = parseToml(readFileSync(ASSETS_TOML, "utf8"));
  const overrides = existsSync(OVERRIDES) ? JSON.parse(readFileSync(OVERRIDES, "utf8")) : {};
  const assets = (toml.assets ?? []).filter((a) => a.active !== false);
  const mints = assets.map((a) => a.mint);

  let jup = new Map();
  try {
    jup = await jupiterIcons(mints);
  } catch (e) {
    console.warn(`! Jupiter batch lookup failed: ${e.message} (overrides only)`);
  }

  const manifest = [];
  for (const a of assets) {
    const candidates = [];
    if (overrides[a.mint]) candidates.push(["override", overrides[a.mint]]);
    if (jup.get(a.mint)) candidates.push(["jupiter", jup.get(a.mint)]);

    let resolved = null;
    for (const [source, url] of candidates) {
      try {
        const buf = await fetchBytes(url);
        await sharp(buf, { density: 384 })
          .resize(SIZE, SIZE, { fit: "cover" })
          .webp({ quality: 90 })
          .toFile(join(OUT_DIR, `${a.mint}.webp`));
        resolved = { source, url };
        break;
      } catch (e) {
        console.warn(`  ${a.symbol}: ${source} failed — ${e.message}`);
      }
    }

    if (resolved) {
      const bytes = statSync(join(OUT_DIR, `${a.mint}.webp`)).size;
      manifest.push({ mint: a.mint, symbol: a.symbol, source: resolved.source, url: resolved.url, bytes });
      console.log(`  ok ${a.symbol.padEnd(10)} <- ${resolved.source}`);
    } else {
      manifest.push({ mint: a.mint, symbol: a.symbol, source: "monogram" });
      console.warn(`  MONOGRAM ${a.symbol} — no icon source resolved`);
    }
  }

  manifest.sort((x, y) => x.symbol.localeCompare(y.symbol));
  writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  const fallbacks = manifest.filter((m) => m.source === "monogram");
  console.log(`\n${manifest.length} assets vendored, ${fallbacks.length} monogram fallback(s).`);
  if (fallbacks.length) {
    console.log(`Add an override in lib/token-icons/overrides.json for: ${fallbacks.map((f) => f.symbol).join(", ")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
