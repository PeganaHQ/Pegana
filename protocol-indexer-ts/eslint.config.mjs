// Flat ESLint config (ESLint 9 + typescript-eslint) for protocol-indexer-ts —
// the Sub-C "Loop Intelligence" poller. Mirrors mcp-ts/eslint.config.mjs.
//
// This file was MISSING while package.json still declared a `lint` script and
// all three eslint deps, so `bun run lint` had always failed with "ESLint
// couldn't find an eslint.config.(js|mjs|cjs) file" — and nothing ran it,
// because this service had no CI job at all. Both are fixed together: the CI
// job in .github/workflows/ci.yml now runs typecheck + lint + test here,
// which is what finally makes the ADR-0036 k-anonymity grep-guard enforced by
// a machine rather than by whoever remembers.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["node_modules/**", "dist/**", "build/**"],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.node,
        Bun: "readonly",
      },
    },
    rules: {
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
);
