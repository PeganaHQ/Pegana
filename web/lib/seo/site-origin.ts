// The canonical public origin. The apex (https://pegana.xyz) answers every
// request with a 308 to www, so any URL we generate on the apex (embed
// snippets, feed links, badge links) costs each reader an extra redirect.
// NEXT_PUBLIC_SITE_URL still wins for previews/local, except that the apex is
// normalised to www.
export const CANONICAL_ORIGIN = "https://www.pegana.xyz";

export function siteOrigin(
  env: string | undefined = process.env.NEXT_PUBLIC_SITE_URL,
): string {
  const v = (env ?? "").trim().replace(/\/+$/, "");
  if (!v) return CANONICAL_ORIGIN;
  if (/^https?:\/\/pegana\.xyz$/i.test(v)) return CANONICAL_ORIGIN;
  return v;
}
