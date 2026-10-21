import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NO_JS_REVEAL_CSS } from "@/lib/motion/no-js-reveal";

function matches(styleAttr: string): boolean {
  // Mirror of the two attribute selectors in NO_JS_REVEAL_CSS.
  return styleAttr.includes("opacity:0;") || styleAttr.endsWith("opacity:0");
}

describe("no-JS reveal fallback", () => {
  it("targets exactly what useRevealV2 server-renders while hidden", () => {
    const html = renderToString(
      <div
        style={{
          transition: "opacity .85s",
          opacity: 0,
          transform: "translateY(18px)",
          filter: "blur(5px)",
        }}
      />,
    );
    const style = /style="([^"]*)"/.exec(html)![1];
    expect(matches(style)).toBe(true);
    expect(NO_JS_REVEAL_CSS).toContain('[style*="opacity:0;"]');
    expect(NO_JS_REVEAL_CSS).toContain('[style$="opacity:0"]');
  });

  it("leaves intentionally dimmed elements alone", () => {
    const html = renderToString(<div style={{ opacity: 0.4 }} />);
    const style = /style="([^"]*)"/.exec(html)![1];
    expect(matches(style)).toBe(false);
  });

  it("is mounted by the marketing layout inside <noscript>", () => {
    const src = readFileSync(
      join(process.cwd(), "app", "(marketing)", "layout.tsx"),
      "utf8",
    );
    expect(src).toMatch(/<noscript>\s*<style>\{NO_JS_REVEAL_CSS\}<\/style>\s*<\/noscript>/);
  });

  it("renders as a noscript style", () => {
    const html = renderToString(
      <noscript>
        <style>{NO_JS_REVEAL_CSS}</style>
      </noscript>,
    );
    expect(html).toContain("<noscript><style>");
    expect(html).toContain("opacity:1!important");
  });
});
