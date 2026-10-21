// Flat ESLint config (ESLint 9 + typescript-eslint) for the Pegana web app
// (Next.js 16 + React 19, run under Bun). ESLint 9 dropped `.eslintrc`, and
// Next 16 removed the `next lint` subcommand — this is the modern replacement
// invoked via `eslint .`.
//
// Intentionally MINIMAL: js.recommended + tseslint.recommended (non
// type-checked) only — NO eslint-plugin-next (its 40+ rules would flood a
// 15k-LoC app that has never been linted). Type-aware checks live in
// `bun run typecheck` (tsc --noEmit), which CI runs as a separate blocking
// step. CI runs this lint NON-BLOCKING during the calibration window; it is
// escalated to blocking after the public launch once the backlog is cleared.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default tseslint.config(
  // Never lint build output, deps, or root config files.
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "dist/**",
      "scripts/**",
      "**/*.config.{ts,mjs,js}",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Next runs components in the browser (window/document) AND server routes in
  // Node (process/Buffer). Declare both global sets so `no-undef` doesn't flag
  // them. The React 19 JSX transform needs no React import, so JSX is fine.
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // Allow intentionally-unused args/vars when prefixed with `_`
      // (render-props, Promise executors). Caught errors with no binding are OK.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
    },
  },

  // Every internal link goes through IntentLink, which prefetches on intent
  // only. A plain `next/link` prefetches the moment it scrolls into view, and
  // on this all-dynamic app each of those is a billed function invocation
  // (see components/atoms/intent-link.tsx for the measurement).
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    ignores: ["components/atoms/intent-link.tsx", "**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/link",
              message:
                'Import Link from "@/components/atoms/intent-link" (intent-only prefetch).',
            },
          ],
        },
      ],
    },
  },

  // The service worker runs in a ServiceWorkerGlobalScope, not a window: no
  // `document`, no `localStorage`, but `caches`, `clients`, `skipWaiting` and a
  // `self` that is the registration. Without this block every one of those is a
  // `no-undef` error, and the usual reaction is to disable the rule for the
  // file, which would also hide real typos in the one script that can serve
  // stale bytes to every visitor.
  {
    files: ["public/sw.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: { ...globals.serviceworker },
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Accessibility.
  //
  // Added 2026-07-31 after a manual audit found a class of defects that NOTHING
  // here could have caught: a skip link whose target sat before the nav it was
  // meant to skip, `<tr onClick>` with no role/tabIndex/key handler as the
  // primary control of /systemic, ~13 Radix TooltipTrigger children that were
  // non-focusable `<span>`/`<div>`s (so the caveat explaining a risk number was
  // mouse-only), and `role="button"` divs with no key handler. Every one of
  // those is a rule below.
  //
  // Deliberately NOT the full `recommended` set: this app has 15k LoC that has
  // never been a11y-linted, and a flood of 40 rules would get the whole block
  // disabled within a week. These are the ones that map to defects actually
  // found in this codebase — the interaction and naming rules, not the
  // stylistic ones.
  {
    files: ["**/*.tsx"],
    plugins: { "jsx-a11y": jsxA11y },
    rules: {
      // The exact /systemic <tr onClick> defect.
      // `handlers` narrowed on purpose: the default list includes onError and
      // onLoad, which are resource-load callbacks (e.g. <img onError> falling
      // back to a placeholder), not user interactions. Flagging those produces
      // noise that gets the whole rule turned off.
      "jsx-a11y/no-noninteractive-element-interactions": [
        "error",
        {
          handlers: [
            "onClick",
            "onMouseDown",
            "onMouseUp",
            "onKeyPress",
            "onKeyDown",
            "onKeyUp",
          ],
        },
      ],
      "jsx-a11y/no-static-element-interactions": "error",
      "jsx-a11y/click-events-have-key-events": "error",
      // A role="button" that ignores Enter/Space is worse than no role at all.
      "jsx-a11y/interactive-supports-focus": "error",
      "jsx-a11y/role-supports-aria-props": "error",
      "jsx-a11y/role-has-required-aria-props": "error",
      // Naming: the class of bug where a control has no accessible name.
      "jsx-a11y/anchor-has-content": "error",
      "jsx-a11y/heading-has-content": "error",
      "jsx-a11y/iframe-has-title": "error",
      "jsx-a11y/img-redundant-alt": "error",
      "jsx-a11y/aria-props": "error",
      "jsx-a11y/aria-role": "error",
      "jsx-a11y/aria-unsupported-elements": "error",
      // Keyboard traps / focus.
      "jsx-a11y/no-autofocus": "warn",
      "jsx-a11y/tabindex-no-positive": "error",
    },
  },
);
