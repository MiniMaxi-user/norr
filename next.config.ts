import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @react-pdf/renderer (issue #119, invoice PDF generation) sits on top of
  // pdfkit, which loads its standard-font metrics (e.g.
  // node_modules/pdfkit/js/standard-fonts/Helvetica.cjs) via a
  // dynamically-constructed `require()` path at runtime, not a static
  // import. Vercel's build-time file tracer can't follow a dynamic require,
  // so those files silently get left out of the deployed serverless
  // function's bundle — it works with `next dev`/`next start` locally
  // (full node_modules on disk) but throws `MODULE_NOT_FOUND` in
  // production. This explicitly forces pdfkit's (and @react-pdf's own, for
  // the same reason — e.g. hyphenation data) non-JS runtime assets into the
  // trace for every route under /quotes, where invoice-actions.ts is used.
  outputFileTracingIncludes: {
    "/quotes/**": ["./node_modules/pdfkit/js/**/*", "./node_modules/@react-pdf/**/*"],
  },
};

export default nextConfig;
