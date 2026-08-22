import type { Metadata } from "next";
import { ThemeProvider } from "@yourorg/ui";
// Design tokens (color scales, spacing, typography, light/dark CSS
// variables) ship from the design system itself per CLAUDE.md rule 4 — the
// app never defines its own tokens or a local globals.css.
import "@yourorg/ui/styles.css";

export const metadata: Metadata = {
  title: "Norr — Field Service Management",
  description: "Multi-tenant Field Service Management SaaS",
};

// `suppressHydrationWarning` on <html> is required by every theme provider
// of this shape (next-themes and equivalents): the class/attribute it
// applies to <html> is set from localStorage before React hydrates, so a
// client/server markup diff on that one attribute is expected and safe to
// suppress — it must NOT be used more broadly than this.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
