// Flat ESLint config (ESLint 9 + typescript-eslint) for the Pegana MCP server
// — a Node/Bun process. Mirrors bot-ts/eslint.config.mjs. Minimal:
// js.recommended + tseslint.recommended (non type-checked); type-aware checks
// live in `bun run typecheck`. CI runs this lint NON-BLOCKING during the
// calibration window, escalated to blocking post-launch.
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
    files: ["src/**/*.ts"],
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

  {
    files: ["test/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.node,
        Bun: "readonly",
      },
    },
  },
);
