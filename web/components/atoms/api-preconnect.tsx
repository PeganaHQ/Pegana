"use client";

import { preconnect } from "react-dom";
import { apiBase } from "@/lib/api/base";

// Every app page (and the landing's live board) fetches the public API during
// first render. Opening the connection early hides ~0.2-0.6s of DNS + TCP +
// TLS (Lighthouse uses-rel-preconnect, measured cold vs warm). `anonymous`
// matches the credential mode of the browser's CORS fetches, so the warmed
// connection is the one those requests reuse. React hoists the hint into
// <head>; this is the pattern Next documents for resource hints.
export function ApiPreconnect() {
  preconnect(apiBase(), { crossOrigin: "anonymous" });
  return null;
}
