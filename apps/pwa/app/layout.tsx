import type { Metadata, Viewport } from "next";
import { ThemeProvider, ThemeScript } from "@yourorg/ui";
// Design tokens (color scales, spacing, typography, light/dark CSS
// variables) ship from the design system itself per CLAUDE.md rule 4 — this
// app never defines its own tokens or a local globals.css.
import "@yourorg/ui/styles.css";
import { RegisterServiceWorker } from "./register-service-worker";

export const metadata: Metadata = {
  title: "Norr Engineer",
  description: "Norr field-engineer PWA",
};

// Pinch-zoom/double-tap-zoom disabled (product feedback, 2026-09-13 — "dit
// mag niet, moet een native app gevoel geven") via `maximumScale`/
// `userScalable`, same as any installed-app-shell PWA; `touch-action:
// manipulation` on `html.ui-pwa-html` (styles.css) is the belt-and-braces
// companion — some browsers still allow a double-tap zoom gesture that
// ignores this viewport meta on its own.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

// Issue #170's whole design (bottom bar, sticky timer card, signature
// canvas, …) was built against the design system's dark palette
// (`html.dark` in packages/ui/src/styles.css), so this app forces dark by
// DEFAULT — but per product feedback (2026-09-12), an engineer can now
// switch to light from the profile sheet (`_nav/profile-sheet.tsx`'s
// `AppearanceSection`), same `@yourorg/ui` `ThemeProvider`/`useTheme`
// (localStorage `norr-ui-theme`) the desktop app already uses, just with
// `defaultTheme="dark"` instead of that app's `"system"` — a field
// engineer's OS-level light preference should never silently override this
// app's own dark-by-default choice the first time they open it.
//
// `suppressHydrationWarning` on <html> is required by every theme provider
// of this shape (see the root desktop app's `app/layout.tsx` for the same
// comment): the class it applies to <html> is set from localStorage before
// React hydrates, so a client/server markup diff on that one attribute is
// expected and safe to suppress — it must NOT be used more broadly than
// this.
//
// `ThemeScript` (bug report, 2026-09-14 — a visible white flash on every
// offline navigation, which is a genuine full document reload the service
// worker answers, see `public/sw.js`'s own top-of-file comment on this same
// date) sets the theme class on <html> synchronously as the document parses
// — BEFORE `ThemeProvider`'s own effect ever gets to run — so a fresh full
// page load never paints so much as one frame of the wrong (default light)
// theme first. Must be rendered FIRST in <head> (ahead of the stylesheet
// import above, and definitely ahead of `children`) and its `attribute`/
// `defaultTheme` props must match `ThemeProvider`'s own below exactly — see
// that component's own doc comment (`@yourorg/ui`) for why.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="ui-pwa-html" suppressHydrationWarning>
      <head>
        <ThemeScript attribute="class" defaultTheme="dark" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#14252c" />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="dark">
          {children}
        </ThemeProvider>
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
