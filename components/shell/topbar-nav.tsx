"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { WebMenu, type WebMenuItem } from "@yourorg/ui/web-client";
import { ChevronDown } from "@yourorg/ui/icons";

/** Client-safe projection of `ResolvedNavItem`: the icon is already a
 * rendered element (a component function can't cross the server/client
 * boundary — see `command-palette.tsx`). */
export interface TopbarNavEntry {
  href: string;
  label: string;
  icon: ReactNode;
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Module menu of the topbar (issue #222): up to 7 direct items plus a
 * "More" dropdown. The active item is the module of the current page — also
 * on detail pages (`/clients/123` keeps "Clients" active). Real `<a>`
 * elements inside `<nav aria-label="Main menu">`, `aria-current="page"` on the
 * active one.
 */
export function TopbarNav({ primary, more }: { primary: TopbarNavEntry[]; more: TopbarNavEntry[] }) {
  const pathname = usePathname();
  const moreActive = more.some((item) => isActive(pathname, item.href));
  const moreItems: WebMenuItem[] = more.map((item) => ({
    key: item.href,
    label: item.label,
    icon: item.icon,
    href: item.href,
  }));

  return (
    <nav className="web-topbar-nav" aria-label="Main menu">
      <ul>
        {primary.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link href={item.href} className="web-nav-item" aria-current={active ? "page" : undefined}>
                {item.icon}
                {item.label}
              </Link>
            </li>
          );
        })}
        {more.length > 0 ? (
          <li>
            <WebMenu
              label="More modules"
              align="start"
              triggerClassName="web-nav-item"
              triggerActive={moreActive}
              trigger={
                <>
                  More
                  <ChevronDown aria-hidden />
                </>
              }
              items={moreItems}
            />
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
