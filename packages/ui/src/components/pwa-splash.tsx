import type { ReactNode } from "react";
import { Logo } from "./logo";

/**
 * Launch splash for the engineer PWA — a full-screen Fjord panel (the same
 * color as the app icon and the manifest's `background_color`, so the OS
 * splash hands over without a visible color jump) with the Snö wordmark
 * zooming in and back out, then fading away. Pure CSS (`.pwa-splash` in
 * pwa.css), no hooks, so it can render from a Server Component layout.
 *
 * Shown only once per app launch: the app sets `html.pwa-launched`
 * (sessionStorage-backed, set synchronously before first paint) on every
 * later full document load, which hides this outright — offline navigations
 * are real full reloads (see apps/pwa/public/sw.js) and must not replay it.
 */
export function PwaSplash() {
  return (
    <div className="pwa-splash" aria-hidden>
      <span className="pwa-splash-mark">
        <Logo />
      </span>
    </div>
  );
}

export interface PwaLoginLayoutProps {
  /** Heading + intro copy + form. */
  children?: ReactNode;
}

/**
 * Mobile login screen for the engineer PWA (DS 08): a navy brand band with
 * the wordmark (same navy as the app bar and the launch splash) above a light
 * content area with the form, field-readable type throughout (`.pwa-login`
 * in pwa.css).
 */
export function PwaLoginLayout({ children }: PwaLoginLayoutProps) {
  return (
    <div className="pwa-login">
      <div className="pwa-login-brand">
        <Logo />
      </div>
      <main className="pwa-login-main">{children}</main>
    </div>
  );
}
