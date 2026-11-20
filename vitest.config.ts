import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests for pure business logic (e.g. counter settlement, e-mail
 * throttling/retry). Tests live next to the code as `*.test.ts`. Minimal setup
 * for #239/#268; the wider test suite is tracked in #261.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["app/**/*.test.ts", "lib/**/*.test.ts"],
  },
});
