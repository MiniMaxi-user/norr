// tsup only bundles JS/TS; `styles.css` is a plain stylesheet consumed
// directly by the app (`import "@yourorg/ui/styles.css"`), never imported
// from a `.ts`/`.tsx` file in this package, so it needs a plain copy into
// `dist/` after every build rather than going through esbuild.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(packageRoot, "dist");
mkdirSync(outDir, { recursive: true });

// `styles.css` (legacy `.ui-*` components) is loaded by both apps. `web.css` is
// the design-system layer (issue #222: tokens + shared components) and is
// loaded by BOTH apps too; `pwa.css` (the field-PWA shell/screens) is loaded
// by the PWA only.
for (const file of ["styles.css", "web.css", "pwa.css"]) {
  copyFileSync(join(packageRoot, "src", file), join(outDir, file));
}
