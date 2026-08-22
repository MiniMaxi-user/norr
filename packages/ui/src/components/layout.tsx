import type { ReactNode } from "react";

export interface AppLayoutProps {
  sidebar?: ReactNode;
  topbar?: ReactNode;
  children?: ReactNode;
}

/**
 * Composition root for the authenticated app chrome: fixed-height shell
 * (`100dvh`) with a fixed sidebar and a fixed topbar — only
 * `.ui-app-layout-content` (the `<main>`) scrolls. This is the "premium
 * app-shell" pattern (Linear/Vercel-dashboard register) called for in
 * docs/ARCHITECTURE.md, and is also what makes `Table`'s sticky header and
 * each page's own sticky `Toolbar` behave correctly — see styles.css.
 */
export function AppLayout({ sidebar, topbar, children }: AppLayoutProps) {
  return (
    <div className="ui-app-layout">
      {sidebar}
      <div className="ui-app-layout-main">
        {topbar}
        <main className="ui-app-layout-content">{children}</main>
      </div>
    </div>
  );
}
