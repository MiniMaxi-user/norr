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
    // packages/*/dist is build output (see packages/ui/package.json) —
    // never hand-edited, excluded from lint like any other build artifact.
    ignores: [".next/**", "out/**", "build/**", "next-env.d.ts", "node_modules/**", "packages/*/dist/**"],
  },
];

export default eslintConfig;
