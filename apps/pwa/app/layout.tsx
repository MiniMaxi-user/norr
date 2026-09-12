import type { Metadata } from "next";
// Design tokens (color scales, spacing, typography, light/dark CSS
// variables) ship from the design system itself per CLAUDE.md rule 4 — this
// app never defines its own tokens or a local globals.css.
import "@yourorg/ui/styles.css";
import { RegisterServiceWorker } from "./register-service-worker";

export const metadata: Metadata = {
  title: "Norr Monteur",
  description: "Norr field-engineer PWA",
};

// Issue #170 — the field PWA's whole design (bottom bar, sticky timer card,
// signature canvas, …) is built against the design system's dark palette
// only (`html.dark` in packages/ui/src/styles.css); there is no light-mode
// treatment for any of it. Unlike the root app (`ThemeProvider` there
// resolves `system`/stored preference, with a real light AND dark palette
// for a desktop back-office user to choose between), this app forces
// `.dark` directly on `<html>` instead of rendering `ThemeProvider` at all —
// a field engineer's OS-level light preference (or a stray
// `localStorage["norr-ui-theme"]` value from an earlier build/experiment on
// this device) must never leak an unstyled light view here. No toggle exists
// anywhere in this app, so there's nothing for `ThemeProvider`'s
// localStorage-restore/system-media-query behavior to usefully do.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl" className="dark">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#14252c" />
      </head>
      <body>
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
