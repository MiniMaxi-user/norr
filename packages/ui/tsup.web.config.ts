import { defineConfig } from "tsup";

// Web design-system layer (issue #222). Built by its own tsup invocation
// (see the `build` script in package.json) AFTER the main config, never as
// extra entries inside it:
//
//  - the main config's `clean: true` pass would race with (and delete)
//    declaration files produced here;
//  - adding entries to the main config could re-split shared chunks and
//    change `dist/index.js` — the bundle the PWA consumes — which must stay
//    byte-identical.
//
// ESM only: the web app (Next) is the sole consumer. `clean: false` so the
// main build's output survives.
const externalPeers = ["react", "react-dom", "react/jsx-runtime", "next", "next/link", "next/navigation"];

export default defineConfig([
  {
    // Server-safe half: `@yourorg/ui/web` (Card, Badge, Button, Timeline,
    // DetailLayout, ...). Hook-free.
    entry: { web: "src/web/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: false,
    external: externalPeers,
  },
  {
    // Interactive half: `@yourorg/ui/web-client` (PageHeader, KeyValueCard,
    // useEditMode, menus, dialogs). One whole bundle behind a single
    // "use client" boundary — same banner / `treeshake: false` reasoning as
    // the client entries in tsup.config.ts.
    entry: { "web-client": "src/web/client.tsx" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: false,
    treeshake: false,
    external: externalPeers,
    banner: { js: '"use client";' },
  },
]);
