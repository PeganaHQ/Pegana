import { buildLlmsFull } from "@/lib/llms/pages";

// Site-wide /llms-full.txt — the same complete page inventory as /llms.txt,
// prefixed with extended context (the intrinsic−market pipeline, per-mechanism
// intrinsic derivation, the Trust Layer, and the Loop Intelligence advisory).
// Static, same source of truth as /llms.txt (lib/llms/pages.ts).
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(buildLlmsFull(), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
