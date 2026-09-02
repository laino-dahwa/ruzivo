import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // electron-builder's packaging output — a build artifact tree, not source.
    "release/**",
    // Compiled electron/*.ts output (CommonJS, tsc-emitted) — not source.
    "dist-electron/**",
  ]),
  {
    // electron-builder's afterPack hook is loaded via require() and must
    // stay plain CommonJS (package.json has no "type": "module"); a .mjs
    // extension isn't an option here since electron-builder resolves this
    // path as a hook script, not an ES module.
    files: ["scripts/electron-after-pack.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
