"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { Breadcrumbs } from "@yourorg/ui";
import { usePageHeader } from "@/components/shell/page-header-context";
import { findSettingsNavItem } from "./settings-nav-items";

/**
 * The Settings shell (issue #110, rail removed by the "Settings landing
 * redesign" handoff): sets the Topbar breadcrumb (`Settings / X`) for every
 * settings route via `usePageHeader`. Used to also render a persistent
 * grouped left rail beside `children` — that rail was removed once
 * `/settings` itself became a real landing page (a card grid over the same
 * `SETTINGS_NAV_GROUPS`, see `settings-landing-view.tsx`): a permanent rail
 * duplicating the same links the landing page already surfaces added no
 * value and ate horizontal space on every settings leaf page for no
 * benefit. Leaf pages now rely on the landing page + this breadcrumb for
 * navigation, same as every other top-level module's detail pages
 * (`app/(app)/work-orders/[id]/page.tsx` etc. have no persistent rail of
 * their own either).
 *
 * Breadcrumb label resolves from `usePathname()` client-side, same
 * reasoning `components/shell/active-nav-item.tsx` gives for why that check
 * can't live in a Server Component.
 */
export function SettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const current = findSettingsNavItem(pathname);
  const currentLabel = current?.item.label;

  const breadcrumbItems = useMemo(
    () => [{ label: "Settings", href: "/settings" }, ...(currentLabel ? [{ label: currentLabel }] : [])],
    [currentLabel],
  );
  // The element itself (not just `breadcrumbItems`) must be memoized — see
  // the "MUST be referentially stable" warning on `usePageHeader`'s doc
  // comment; an inline `<Breadcrumbs items={breadcrumbItems} />` here would
  // be a fresh element every render and infinite-loop. Same pattern as
  // `app/(app)/clients/[id]/client-detail.tsx`.
  const breadcrumbNode = useMemo(() => <Breadcrumbs items={breadcrumbItems} />, [breadcrumbItems]);
  usePageHeader(breadcrumbNode);

  return <>{children}</>;
}
