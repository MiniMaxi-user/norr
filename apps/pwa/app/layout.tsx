import type { Metadata } from "next";
import { ThemeProvider } from "@yourorg/ui";
// Design tokens (color scales, spacing, typography, light/dark CSS
// variables) ship from the design system itself per CLAUDE.md rule 4 — this
// app never defines its own tokens or a local globals.css.
import "@yourorg/ui/styles.css";
import { RegisterServiceWorker } from "./register-service-worker";

export const metadata: Metadata = {
  title: "Norr Monteur",
  description: "Norr field-engineer PWA",
};

// Issue #170's whole design (bottom bar, sticky timer card, signature
// canvas, …) was built against the design system's dark palette
// (`html.dark` in packages/ui/src/styles.css), so this app forces dark by
// DEFAULT — but per product feedback (2026-09-12), an engineer can now
// switch to light from the profile sheet (`today/profile-sheet.tsx`'s
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
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl" suppressHydrationWarning>
      <head>
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
