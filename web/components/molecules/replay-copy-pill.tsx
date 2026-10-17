"use client";

import { useState } from "react";

// W2 (2026-07-03): the receipt page's primary CTA is "Replay this receipt" —
// per the approved artifact this copies the CLI command (the actual replay
// runs on the visitor's own machine, or in-browser via ReceiptVerifier just
// above it), so it's a real <button> with the same PillPrimary visual
// treatment rather than a <Link>.

export function ReplayCopyPill({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(command);
        ok = true;
      }
    } catch {
      // fall through
    }
    if (!ok && typeof document !== "undefined") {
      const ta = document.createElement("textarea");
      ta.value = command;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      document.body.removeChild(ta);
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="group inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-mono text-[12px] font-medium uppercase tracking-[0.09em] text-[#141118] shadow-[0_4px_20px_rgba(0,0,0,.35)] transition-[transform,box-shadow,background] duration-[280ms] ease-[var(--v2-ease)] hover:-translate-y-px hover:bg-[#efeaf6]"
    >
      {copied ? "Copied" : "Replay this receipt"}
      <span
        aria-hidden
        className="-my-1 ml-0.5 -mr-2.5 grid h-[22px] w-[22px] place-items-center rounded-full bg-[rgba(20,17,24,.09)] text-[11px] transition-transform duration-500 ease-[var(--v2-ease-phys)] group-hover:translate-x-1"
      >
        &#8594;
      </span>
    </button>
  );
}
