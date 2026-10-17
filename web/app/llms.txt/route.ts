import { buildLlmsIndex } from "@/lib/llms/pages";

// Site-wide /llms.txt — the concise, machine-readable index of the whole
// pegana.xyz surface (marketing + console + trust/data + API & docs), per the
// llmstxt.org convention. Static: the page list is a hardcoded const, so this
// prerenders at build. The developer-docs' OWN llms.txt lives at
// https://docs.pegana.xyz/llms.txt (Mintlify custom domain).
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(buildLlmsIndex(), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
