import type { Source } from "./poll";

/** Restrict sources to a comma-separated allowlist; empty/unset keeps all. */
export function filterSources(all: Source[], allow: string | undefined): Source[] {
  const names = (allow ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (names.length === 0) return all;
  return all.filter((s) => names.includes(s.name));
}
