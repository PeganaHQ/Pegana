"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import type { Lang } from "@/lib/types/code-lang";

interface Props {
  code: string;
  lang?: Lang;
  filename?: string;
  className?: string;
  showCopy?: boolean;
}

export function CodeBlock({
  code,
  lang = "text",
  filename,
  className,
  showCopy = true,
}: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        ok = true;
      }
    } catch {
      // Modern API rejected (permissions, headless, http context).
    }
    if (!ok && typeof document !== "undefined") {
      // execCommand fallback — deprecated but works without permission prompts.
      const ta = document.createElement("textarea");
      ta.value = code;
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
  };

  return (
    <div className={cn("relative", className)}>
      {filename && (
        <div className="flex items-center justify-between border border-b-0 border-hairline bg-surface-1/30 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">
          <span>{filename}</span>
          <span className="text-text-caption">{LANG_LABEL[lang]}</span>
        </div>
      )}
      <pre
        data-code-block
        tabIndex={0}
        aria-label={filename ? `${filename} code block` : "Code block"}
        className="overflow-x-auto border border-hairline px-4 py-3 font-mono text-[11px] leading-relaxed text-text sm:text-[12px]"
      >
        <code>{highlight(code, lang)}</code>
      </pre>
      {showCopy && (
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? "Copied to clipboard" : "Copy to clipboard"}
          className={cn(
            "absolute right-2 border border-hairline bg-canvas/80 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] backdrop-blur transition-colors hover:border-outline hover:text-text",
            filename ? "top-9" : "top-2",
            copied ? "border-st-pegged/60 text-st-pegged" : "text-text-muted",
          )}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      )}
    </div>
  );
}

const LANG_LABEL: Record<Lang, string> = {
  bash: "shell",
  js: "javascript",
  ts: "typescript",
  python: "python",
  html: "html",
  react: "tsx",
  text: "",
};

// ---------------------------------------------------------------------------
// Inline highlighter — span-injection, zero deps. Five tones:
//   url    → st-pegged
//   keyword→ accent yellow (feed7a)
//   string → text
//   number → st-drift
//   comment→ text-caption
// ---------------------------------------------------------------------------

const KEYWORDS_BY_LANG: Record<Lang, ReadonlyArray<string>> = {
  bash: ["curl", "wscat", "jq", "export", "echo"],
  js: [
    "const",
    "let",
    "var",
    "function",
    "async",
    "await",
    "return",
    "if",
    "else",
    "for",
    "import",
    "from",
    "export",
    "default",
    "new",
    "typeof",
    "true",
    "false",
    "null",
    "undefined",
  ],
  ts: [
    "const",
    "let",
    "var",
    "function",
    "async",
    "await",
    "return",
    "if",
    "else",
    "for",
    "import",
    "from",
    "export",
    "default",
    "new",
    "typeof",
    "true",
    "false",
    "null",
    "undefined",
    "interface",
    "type",
    "as",
  ],
  python: [
    "import",
    "from",
    "def",
    "class",
    "return",
    "if",
    "else",
    "elif",
    "for",
    "while",
    "in",
    "not",
    "and",
    "or",
    "True",
    "False",
    "None",
    "lambda",
    "with",
    "as",
    "yield",
  ],
  html: ["iframe", "src", "width", "height", "loading", "title", "frameborder"],
  react: [
    "const",
    "let",
    "function",
    "async",
    "await",
    "return",
    "import",
    "from",
    "export",
    "default",
    "interface",
    "type",
  ],
  text: [],
};

interface Token {
  text: string;
  kind: "url" | "keyword" | "string" | "number" | "comment" | "plain";
}

function tokenize(code: string, lang: Lang): Token[] {
  const tokens: Token[] = [];
  const keywords = new Set(KEYWORDS_BY_LANG[lang]);

  // Match in priority order: comments → strings → urls → numbers → keywords → plain
  // Splitting line by line keeps single-line comments well-bounded.
  const lines = code.split("\n");
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let i = 0;
    while (i < line.length) {
      const rest = line.slice(i);

      // Comment — // for js/ts/react, # for bash/python
      const commentStart =
        (lang === "js" || lang === "ts" || lang === "react") &&
        rest.startsWith("//")
          ? "//"
          : (lang === "bash" || lang === "python") && rest.startsWith("#")
            ? "#"
            : null;
      if (commentStart) {
        tokens.push({ text: line.slice(i), kind: "comment" });
        i = line.length;
        continue;
      }

      // String — single, double, or backtick (template literals not escaped, good enough for docs)
      const stringQuote =
        rest[0] === '"' || rest[0] === "'" || rest[0] === "`" ? rest[0] : null;
      if (stringQuote) {
        let j = 1;
        while (j < rest.length && rest[j] !== stringQuote) {
          if (rest[j] === "\\") j += 2;
          else j += 1;
        }
        tokens.push({ text: rest.slice(0, j + 1), kind: "string" });
        i += j + 1;
        continue;
      }

      // URL — https://, wss://, http://, ws://
      const urlMatch = rest.match(/^(https?:\/\/|wss?:\/\/)[^\s"')<>]+/);
      if (urlMatch) {
        tokens.push({ text: urlMatch[0], kind: "url" });
        i += urlMatch[0].length;
        continue;
      }

      // Number — supports decimals and bps suffixes
      const numMatch = rest.match(/^-?\d+(\.\d+)?(_\d+)?/);
      if (numMatch) {
        tokens.push({ text: numMatch[0], kind: "number" });
        i += numMatch[0].length;
        continue;
      }

      // Keyword — word boundary
      const wordMatch = rest.match(/^[A-Za-z_$][\w$]*/);
      if (wordMatch && keywords.has(wordMatch[0])) {
        tokens.push({ text: wordMatch[0], kind: "keyword" });
        i += wordMatch[0].length;
        continue;
      }
      if (wordMatch) {
        tokens.push({ text: wordMatch[0], kind: "plain" });
        i += wordMatch[0].length;
        continue;
      }

      // One char of punctuation/whitespace
      tokens.push({ text: rest[0], kind: "plain" });
      i += 1;
    }
    if (li < lines.length - 1) tokens.push({ text: "\n", kind: "plain" });
  }
  return tokens;
}

function highlight(code: string, lang: Lang) {
  if (lang === "text") return code;
  const tokens = tokenize(code, lang);
  return tokens.map((t, idx) => {
    if (t.kind === "plain") return <span key={idx}>{t.text}</span>;
    const className =
      t.kind === "url"
        ? "text-st-pegged"
        : t.kind === "keyword"
          ? "text-coral"
          : t.kind === "string"
            ? "text-text"
            : t.kind === "number"
              ? "text-st-drift"
              : "text-text-caption";
    return (
      <span key={idx} className={className}>
        {t.text}
      </span>
    );
  });
}
