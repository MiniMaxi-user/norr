import { defineConfig } from "tsup";

// `client.tsx` and `tabs.tsx` are the only two source files with a
// top-level `"use client"` directive (ThemeProvider/useTheme's context +
// hooks, and Tabs' active-tab state). Everything else in this package is a
// plain presentational function — no hooks, no browser-only APIs — safe to
// render from either a Server or Client Component, matching this design
// system's "no unnecessary 'use client'" rule and keeping the app's
// "Server Components by default" architecture (CLAUDE.md rule 5) intact
// for every other primitive this package exports.
//
// `combobox.tsx` joined this list for the same reason — it owns real
// open/query/highlighted-index state (issue #54) — and gets its own
// `dist/combobox.js` entry below exactly the same way. It lives at the same
// top level of `src/` as the other three (not under `src/components/`,
// unlike every other component in this package) — required, not cosmetic:
// `index.ts` imports it via the literal relative specifier `"./combobox.js"`,
// which the CJS build below must physically resolve on disk relative to
// `index.ts`'s own directory (that build does NOT mark these four modules
// `external` — see its own comment) — confirmed empirically, nesting it
// under `components/` broke that resolution with "Could not resolve
// './combobox.js'".
//
// `confirm-delete-dialog.tsx` (issue #77) joined this list for the same
// reason again — it owns checking/error/deleting state — same top-level
// `src/` placement, same `"./confirm-delete-dialog.js"` re-export shape.
//
// `use-escape-to-close.ts` (issue #67) SHOULD have joined this list when it
// was added and didn't — a real regression, not a hypothetical: it owns
// hook state (`useEffect`/`useRef`) exactly like every module above, so
// once it was reachable from `index.js` (imported by `app/layout.tsx`),
// `next build` failed with "You're importing a component that needs
// useEffect" — `tsc --noEmit` alone never catches this, only a real
// `next build` does. Fixed by giving it the same dedicated-entry treatment.
//
// The app imports `ThemeProvider`/`Tabs` from the package's *main* entry
// (`@yourorg/ui`), not a `./client`/`./tabs` subpath, so `index.ts`
// re-exports them — which is the tricky part, confirmed empirically while
// building this package:
//
//   1. `tsup`'s `treeshake: true` option pipes esbuild's output through
//      Rollup for extra dead-code elimination, and that Rollup pass drops
//      any top-level `"use client"` directive entirely (esbuild alone
//      preserves it fine — verified by calling esbuild directly with the
//      same input). So `treeshake` must stay `false` for any entry whose
//      directive needs to survive. A `banner` re-adds it explicitly anyway,
//      as a second, redundant safety net (harmless if esbuild's own
//      preservation ever regresses — Next only needs the directive to be
//      the file's literal first statement, so two copies is fine).
//   2. Even with the directive surviving, `index.ts` re-exporting `from
//      "./client"` would still lose it the moment esbuild *inlines*
//      `client.tsx`'s source into `index.js`'s own bundle (a directive only
//      "counts" as being on a file if the whole file is that one client
//      boundary — inlined into a larger multi-export file, Next can no
//      longer tell which exports came from the client-marked module). Fix:
//      `client.tsx`/`tabs.tsx` are built as their OWN tsup config (below),
//      producing their own complete `dist/client.js`/`dist/tabs.js`; and
//      `index.ts` marks those exact specifiers ("./client.js", "./tabs.js"
//      — see src/index.ts) `external`, so esbuild leaves them as real
//      `import` statements pointing at those sibling files instead of
//      inlining/duplicating their source into `index.js`.
//
// This only matters for the ESM build, since Next.js resolves the
// package's `import` condition (see package.json `exports`). The CJS
// build (kept only for non-Next tooling that still `require()`s, e.g.
// Jest/ts-node) doesn't need any of this: each entry is fully
// self-contained there, which is fine since CJS output isn't what Next's
// RSC module graph walks.
const clientBoundaryModules = [
  "./client.js",
  "./tabs.js",
  "./toast.js",
  "./combobox.js",
  "./confirm-delete-dialog.js",
  "./use-escape-to-close.js",
];
const externalPeers = ["react", "react-dom", "react/jsx-runtime", "next", "next/link"];

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      icons: "src/icons.tsx",
    },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    external: [...externalPeers, ...clientBoundaryModules],
  },
  {
    entry: {
      client: "src/client.tsx",
      tabs: "src/tabs.tsx",
      toast: "src/toast.tsx",
      combobox: "src/combobox.tsx",
      "confirm-delete-dialog": "src/confirm-delete-dialog.tsx",
      "use-escape-to-close": "src/use-escape-to-close.ts",
    },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: false,
    // Must stay false — see the top-of-file comment (point 1).
    treeshake: false,
    external: externalPeers,
    banner: { js: '"use client";' },
  },
  {
    // Non-split, fully self-contained CJS build — see comment above.
    entry: {
      index: "src/index.ts",
      icons: "src/icons.tsx",
      client: "src/client.tsx",
      tabs: "src/tabs.tsx",
      toast: "src/toast.tsx",
      combobox: "src/combobox.tsx",
      "confirm-delete-dialog": "src/confirm-delete-dialog.tsx",
      "use-escape-to-close": "src/use-escape-to-close.ts",
    },
    format: ["cjs"],
    dts: false,
    sourcemap: true,
    clean: false,
    external: externalPeers,
  },
]);
