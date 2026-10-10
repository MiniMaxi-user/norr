import type { ReactNode } from "react";
import { Logo } from "./logo";

/**
 * Launch splash for the engineer PWA — a full-screen Fjord panel (the same
 * color as the app icon and the manifest's `background_color`, so the OS
 * splash hands over without a visible color jump) with the Snö wordmark
 * zooming in and back out, then fading away. Pure CSS (`.ui-pwa-splash` in
 * styles.css), no hooks, so it can render from a Server Component layout.
 *
 * Shown only once per app launch: the app sets `html.ui-pwa-launched`
 * (sessionStorage-backed, set synchronously before first paint) on every
 * later full document load, which hides this outright — offline navigations
 * are real full reloads (see apps/pwa/public/sw.js) and must not replay it.
 */
export function PwaSplash() {
  return (
    <div className="ui-pwa-splash" aria-hidden>
      <span className="ui-pwa-splash-mark">
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
 * Mobile login screen for the engineer PWA — vertically centered column with
 * a large wordmark on top and larger, field-readable type for the heading,
 * copy, labels, inputs and button (`.ui-pwa-login` in styles.css).
 */
export function PwaLoginLayout({ children }: PwaLoginLayoutProps) {
  return (
    <div className="ui-pwa-login">
      <div className="ui-pwa-login-logo">
        <Logo />
      </div>
      <div className="ui-pwa-login-card">{children}</div>
    </div>
  );
}
