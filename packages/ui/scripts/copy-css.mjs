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

// `styles.css` is shared by the web app and the PWA. `web.css` (issue #222,
// the new web design system) is imported ONLY by the web app — it is a
// separate file precisely so none of it can reach the PWA.
for (const file of ["styles.css", "web.css"]) {
  copyFileSync(join(packageRoot, "src", file), join(outDir, file));
}
