import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // These React Compiler advisory rules currently report event handlers and
    // one-time localStorage hydration as render-time side effects. The app does
    // not enable the React Compiler; keep the actionable hook rules enabled.
    rules: {
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    ".wrangler/**",
    "windows-app/release/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
