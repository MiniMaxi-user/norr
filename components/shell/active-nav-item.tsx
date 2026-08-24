"use client";

import { usePathname } from "next/navigation";
import { NavItem, type NavItemProps } from "@yourorg/ui";

/**
 * Thin client boundary around `NavItem` — the *only* thing that needs
 * `usePathname()` is the active/current-route check, so that's the only
 * thing this wrapper does. `NavItem` itself stays a plain, hook-free,
 * server-safe component (see packages/ui/src/components/nav.tsx); the nav
 * list (`AppSidebar`) stays a Server Component rendering real data, same as
 * before this file existed — only each individual row's className now
 * resolves client-side.
 *
 * `/` (Dashboard) matches only the exact root path; every other item also
 * matches its own sub-routes (e.g. `/clients/123` keeps "Clients" active) —
 * otherwise a detail page would show no active nav item at all.
 */
export function ActiveNavItem({ href, ...rest }: NavItemProps) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return <NavItem href={href} active={active} {...rest} />;
}
