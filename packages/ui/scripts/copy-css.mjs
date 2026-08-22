// tsup only bundles JS/TS; `styles.css` is a plain stylesheet consumed
// directly by the app (`import "@yourorg/ui/styles.css"`), never imported
// from a `.ts`/`.tsx` file in this package, so it needs a plain copy into
// `dist/` after every build rather than going through esbuild.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const from = join(packageRoot, "src", "styles.css");
const to = join(packageRoot, "dist", "styles.css");

mkdirSync(dirname(to), { recursive: true });
copyFileSync(from, to);
