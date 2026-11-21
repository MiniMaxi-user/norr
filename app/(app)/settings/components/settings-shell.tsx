"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { WebSettingsHeader, WebSettingsMain, WebSettingsNav, WebSettingsPage } from "@yourorg/ui/web";
import { findSettingsNavItem, SETTINGS_NAV_GROUPS } from "./settings-nav-items";

/**
 * The Settings frame (issue #110, restyled for the web design system in
 * #222): a grouped section nav on the left (its own scroll, active section
 * marked), and on the right a header plus ONE scroll area
 * (`scrollbar-gutter: stable`) — the browser page never scrolls.
 *
 *  - The nav is shown on every route, the landing included, and scrolls the
 *    active section into view.
 *  - A list/tree section renders inside the frame unchanged: the frame adds a
 *    header (breadcrumb `Settings / <section>`, title = section name) and puts
 *    `children` in the scroll area.
 *  - A form-type section (`ownHeader` in `settings-nav-items.ts`) renders its
 *    own `PageHeader` (Edit / Save live in the header) followed by
 *    `WebSettingsMain`, so the frame only supplies the nav column.
 *
 * The active section comes from `usePathname()` client-side, same reasoning
 * `components/shell/active-nav-item.tsx` gives for why that check can't live in
 * a Server Component.
 */
export function SettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLanding = pathname === "/settings";
  const current = findSettingsNavItem(pathname);
  const activeHref = current?.item.href ?? null;

  // Keep the active section visible in the nav (its own scroll area): on opening
  // a section directly, the nav scrolls so that section is in view.
  useEffect(() => {
    if (!activeHref) return;
    document
      .querySelector<HTMLElement>('.web-settings-nav [aria-current="page"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeHref]);

  // The nav is always shown, also on the landing, so every section is one click away.
  const nav = <WebSettingsNav groups={SETTINGS_NAV_GROUPS} activeHref={activeHref} />;

  if (current?.item.ownHeader) {
    return <WebSettingsPage nav={nav}>{children}</WebSettingsPage>;
  }

  const title = current?.item.label ?? "Settings";
  const breadcrumb = isLanding
    ? [{ label: "Settings" }]
    : [{ label: "Settings", href: "/settings" }, ...(current ? [{ label: current.item.label }] : [])];
  const badge = current && current.group.label !== current.item.label ? current.group.label : null;

  return (
    <WebSettingsPage nav={nav}>
      <WebSettingsHeader breadcrumb={breadcrumb} title={title} badge={badge} />
      <WebSettingsMain>{children}</WebSettingsMain>
    </WebSettingsPage>
  );
}
