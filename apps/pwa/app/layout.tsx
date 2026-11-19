import type { Metadata, Viewport } from "next";
import { PwaSplash } from "@yourorg/ui";
// Design tokens + the shared components (Badge, Button, Card, ...) ship from
// the design system itself per CLAUDE.md rule 4 — this app never defines its
// own tokens or a local globals.css. `styles.css` = the legacy `.ui-*`
// components, `web.css` = the one shared token set + the shared `.web-*`
// components (the PWA uses their `size="touch"` variant), `pwa.css` = the
// field-app shell, nav and screens (loaded by this app only).
import "@yourorg/ui/styles.css";
import "@yourorg/ui/web.css";
import "@yourorg/ui/pwa.css";
import { RegisterServiceWorker } from "./register-service-worker";

export const metadata: Metadata = {
  title: "Norr Engineer",
  description: "Norr field-engineer PWA",
};

// Pinch-zoom/double-tap-zoom disabled (product feedback, 2026-09-13 — "dit
// mag niet, moet een native app gevoel geven") via `maximumScale`/
// `userScalable`, same as any installed-app-shell PWA; `touch-action:
// manipulation` on `html.pwa-html` (pwa.css) is the belt-and-braces
// companion — some browsers still allow a double-tap zoom gesture that
// ignores this viewport meta on its own.
//
// `themeColor` is the navy app-bar colour (`header-bg`, #1f3540): the
// device's status area is painted in the same navy as the app bar.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#1f3540",
};

// The PWA is LIGHT ONLY (issue #222, DS 08 — the design system defines a
// single light theme; the earlier dark-by-default palette and the profile
// sheet's Appearance toggle are gone). Same approach as the web app's own
// `app/layout.tsx`: instead of `ThemeProvider`/`ThemeScript` — which resolve
// the theme from localStorage/`prefers-color-scheme` and could therefore
// still apply `html.dark` (e.g. a value left in localStorage by the old
// toggle) — the root element carries a static `light` class and a tiny
// blocking script strips any `dark` class before first paint.
//
// `suppressHydrationWarning` on <html> because that script and the launch
// script below change `<html>`'s class before React hydrates; it must NOT be
// used more broadly than this.
//
// Launch splash (product feedback, 2026-10-10): `PwaSplash` plays once per
// app launch. Offline navigations are genuine full document reloads (see
// public/sw.js), so this runs synchronously in <head> — before first paint —
// and marks every later load of the same launch with `html.pwa-launched`,
// which hides the splash outright. sessionStorage lives exactly as long as
// the app's own browsing session, i.e. resets on a real relaunch.
const FORCE_LIGHT_SCRIPT =
  'document.documentElement.classList.remove("dark");document.documentElement.classList.add("light");';
const LAUNCH_SCRIPT = `try{var k="norr-pwa-launched";if(sessionStorage.getItem(k)){document.documentElement.classList.add("pwa-launched")}else{sessionStorage.setItem(k,"1")}}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="pwa-html light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: FORCE_LIGHT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: LAUNCH_SCRIPT }} />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      </head>
      <body>
        <PwaSplash />
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
