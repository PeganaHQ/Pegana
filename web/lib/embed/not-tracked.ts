// Shared "not tracked" response for the embed surfaces (/embed/badge/* and
// /embed/<asset>). See lib/asset/public-surface.ts for when it applies.

function xmlEscape(s: string): string {
  return s.replace(
    /[<>&'"]/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      })[c] ?? c,
  );
}

/** Neutral badge for a symbol Pegana does not publish a verdict for. Grey,
 *  no spread, no state word, and a 404 so link checkers see the truth. */
export function notTrackedResponse(shownSymbol: string, svg: boolean): Response {
  const cache = "public, s-maxage=300, stale-while-revalidate=600";
  if (svg) {
    const left = xmlEscape(shownSymbol);
    const right = "not tracked";
    const leftW = Math.max(left.length * 7 + 16, 40);
    const rightW = right.length * 7 + 16;
    const totalW = leftW + rightW;
    const body = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="20" role="img" aria-label="${left}: not tracked by Pegana">
<title>${left}: not tracked by Pegana</title>
<clipPath id="r"><rect width="${totalW}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${leftW}" height="20" fill="#555"/><rect x="${leftW}" width="${rightW}" height="20" fill="#8f8aa3"/></g>
<g fill="#fff" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="11" letter-spacing=".5">
  <text x="${leftW / 2}" y="14">${left}</text>
  <text x="${leftW + rightW / 2}" y="14">${right}</text>
</g>
</svg>`;
    return new Response(body, {
      status: 404,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": cache,
        "Content-Security-Policy": "frame-ancestors *;",
      },
    });
  }
  const body = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${xmlEscape(shownSymbol)} is not tracked · Pegana</title>
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  body { font: 13px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, system-ui, sans-serif; color: #8f8aa3; }
  div { width: 320px; box-sizing: border-box; padding: 10px 12px; background: #0a0a0b; border: 1px solid #1f1f22; }
</style>
</head>
<body><div>${xmlEscape(shownSymbol)} is not tracked by Pegana.</div></body>
</html>`;
  return new Response(body, {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": cache,
      "Content-Security-Policy": "frame-ancestors *;",
    },
  });
}
