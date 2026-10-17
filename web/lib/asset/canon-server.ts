import fs from "node:fs/promises";
import path from "node:path";
import { parseAssetsToml, type CanonAssetMeta } from "@/lib/asset/canon";

const REPO_ROOT = path.join(process.cwd(), "..");

export async function loadAssetsCanonFromRepo(
  label = "assets canon",
): Promise<CanonAssetMeta[]> {
  try {
    const raw = await fs.readFile(path.join(REPO_ROOT, "assets.toml"), "utf-8");
    return parseAssetsToml(raw);
  } catch (err) {
    console.warn(`${label}: assets.toml unavailable`, err);
    return [];
  }
}
