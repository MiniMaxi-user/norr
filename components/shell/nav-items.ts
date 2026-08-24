import type { ComponentType } from "react";
import {
  LayoutDashboard,
  Users,
  Boxes,
  FileText,
  CalendarDays,
  ClipboardList,
  BarChart3,
  Receipt,
  Settings,
} from "@yourorg/ui/icons";
import { hasFeature, type FeatureKey, type FeatureOrganization } from "@/lib/rbac/features";

/**
 * Single source of truth for primary nav entries, shared by the sidebar
 * and the command palette so they never drift out of sync.
 *
 * `moduleKey` matches the `module:*` labels used on the GitHub project
 * board (docs/ROADMAP.md) and doubles as the `hasFeature()` key (CLAUDE.md
 * rule 3) — see `resolveNavItems` below.
 */
export interface NavItem {
  moduleKey: FeatureKey;
  label: string;
  href: string;
  icon: ComponentType;
}

export interface ResolvedNavItem extends NavItem {
  /** Real entitlement result from `hasFeature(organization, moduleKey)` —
   * NOT a hardcoded placeholder anymore (issue #4). A module can be
   * disabled either because the org isn't entitled to it, or (today, Phase
   * 0/1) because it simply hasn't shipped yet — see lib/rbac/features.ts. */
  enabled: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { moduleKey: "dashboard", label: "Dashboard", href: "/", icon: LayoutDashboard },
  { moduleKey: "clients", label: "Clients", href: "/clients", icon: Users },
  { moduleKey: "assets", label: "Assets", href: "/assets", icon: Boxes },
  { moduleKey: "contracts", label: "Contracts", href: "/contracts", icon: FileText },
  // Route is `/work-orders` (the Work Order entity, issue #13) rather than
  // `/planning` — the fuller multi-view (list/kanban/calendar/map,
  // drag-and-drop) Planning/Dispatch board named in docs/ROADMAP.md is
  // separate, larger, follow-on work that may claim `/planning` later.
  // `moduleKey`/entitlement stays `planning` either way (that's the feature
  // key + RBAC matrix row both already use).
  { moduleKey: "planning", label: "Work Orders", href: "/work-orders", icon: CalendarDays },
  // Quotes / Estimates (issue #16, third stage — frontend). `moduleKey`
  // matches the `quotes` feature key/RBAC module both already registered in
  // lib/rbac/features.ts / lib/rbac/permissions.ts.
  { moduleKey: "quotes", label: "Quotes", href: "/quotes", icon: ClipboardList },
  { moduleKey: "reporting", label: "Reporting", href: "/reporting", icon: BarChart3 },
  { moduleKey: "billing", label: "Facturatie", href: "/billing", icon: Receipt },
  // Everyone can *view* Settings (read-only for non-owners — see
  // `lib/rbac/permissions.ts`'s `settings` entry); the module itself is
  // gated only on entitlement (`hasFeature`) like every other nav item, not
  // on role, same as e.g. Clients showing up for every tenant role.
  { moduleKey: "settings", label: "Settings", href: "/settings", icon: Settings },
];

/**
 * Resolves every nav item's real `enabled` state via `hasFeature()`. This is
 * async (a real `hasFeature()` implementation queries `organization_features`
 * once that table exists — see lib/rbac/features.ts) so it must run
 * server-side; the result is plain data, threaded down as props to whatever
 * needs it — including client components like `command-palette.tsx`, which
 * cannot call `hasFeature()` (a server-only DB-backed helper) directly.
 *
 * `organization` is `null` for a signed-in user with no tenant membership
 * yet (e.g. a platform-admin-only account) — every item resolves to
 * `enabled: false` in that case (see `hasFeature`).
 */
export async function resolveNavItems(
  organization: FeatureOrganization | null,
): Promise<ResolvedNavItem[]> {
  return Promise.all(
    NAV_ITEMS.map(async (item) => ({
      ...item,
      enabled: await hasFeature(organization, item.moduleKey),
    })),
  );
}
