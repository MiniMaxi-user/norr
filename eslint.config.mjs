import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // vendor/yourorg-ui-stub is a TEMPORARY plain-CJS stand-in for the real
    // @yourorg/ui package (see its package.json) — not app code, excluded
    // from lint the same way a vendored dependency would be.
    ignores: [".next/**", "out/**", "build/**", "next-env.d.ts", "node_modules/**", "vendor/**"],
  },
];

export default eslintConfig;
