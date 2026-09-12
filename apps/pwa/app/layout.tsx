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

// `suppressHydrationWarning` on <html> is required by ThemeProvider (see
// root app/layout.tsx for the full explanation) — the class/attribute it
// applies to <html> is set from localStorage before React hydrates.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#1f3540" />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
