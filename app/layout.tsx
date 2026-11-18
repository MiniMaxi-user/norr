import type { Metadata } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ToastProvider } from "@yourorg/ui";
// Design tokens (color scales, spacing, typography, light/dark CSS
// variables) ship from the design system itself per CLAUDE.md rule 4 — the
// app never defines its own tokens or a local globals.css.
import "@yourorg/ui/styles.css";
// Web design system (issue #222): tokens + web-only component styles. Imported
// ONLY here — the PWA never loads it (it imports styles.css alone), so none of
// it can leak into the field app.
import "@yourorg/ui/web.css";

export const metadata: Metadata = {
  title: "Norr — Field Service Management",
  description: "Multi-tenant Field Service Management SaaS",
  // Real brand favicon (docs/logo/norr-favicon-{16,32}.svg — N in Snö on
  // solid Fjord, per docs/logo/LEESMIJ.txt), copied into `public/` since
  // Next's metadata `icons` convention resolves relative to it.
  icons: {
    icon: [
      { url: "/favicon-16.svg", sizes: "16x16", type: "image/svg+xml" },
      { url: "/favicon-32.svg", sizes: "32x32", type: "image/svg+xml" },
    ],
  },
};

// Web is LIGHT ONLY (issue #222; the design system defines a single light
// theme and the theme toggle is hidden). Instead of `ThemeProvider`/
// `ThemeScript` — which resolve the theme from localStorage/`prefers-color-
// scheme` and could therefore still apply `html.dark` — the root element
// carries a static `light` class and a tiny blocking script strips any
// `dark` class before first paint. Nothing else in the web app ever adds one.
// The PWA keeps its own forced-dark ThemeProvider (apps/pwa/app/layout.tsx).
const FORCE_LIGHT_SCRIPT =
  'document.documentElement.classList.remove("dark");document.documentElement.classList.add("light");';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: FORCE_LIGHT_SCRIPT }} />
      </head>
      <body>
          {/* Mounted once at the app root (issue #94, "Maak Quote" — its
           * first real caller, see `work-orders/[id]/work-order-detail-
           * actions.tsx`) so `toast()` can be called from anywhere in the
           * tree, including right before a `router.push()` navigates away —
           * a toast survives that navigation, an inline banner never could. */}
          <ToastProvider>{children}</ToastProvider>
        {/* Real-user Core Web Vitals (LCP/CLS/INP) reporting (issue #150,
         * performance breakdown from #139) — mounted once at the app root so
         * it covers every route, same placement Vercel's own docs show. Data
         * shows up under the "Speed Insights" tab of this project in the
         * Vercel dashboard; there is nothing to read locally/in logs. */}
        <SpeedInsights />
      </body>
    </html>
  );
}
