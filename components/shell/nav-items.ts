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
  ShieldCheck,
  Bell,
} from "@yourorg/ui/icons";
import { hasFeature, type FeatureKey, type FeatureOrganization } from "@/lib/rbac/features";

/**
 * Single source of truth for primary nav entries, shared by the sidebar
 * and the command palette so they never drift out of sync.
 *
 * `moduleKey` matches the `module:*` labels used on the GitHub project
 * board (docs/ROADMAP.md) and doubles as the `hasFeature()` key (CLAUDE.md
 * rule 3) — see `resolveNavItems` below.
 *
 * `group` clusters entries under a small uppercase heading in the sidebar
 * (see `NavGroupLabel` in @yourorg/ui and `AppSidebar` below) — matching
 * every reference topbar/sidebar screenshot in docs/designexamples, all of
 * which group nav entries instead of one flat list. Purely a display
 * grouping, not a data model — items keep their existing flat array order,
 * consecutive items sharing a `group` render under one heading.
 */
export interface NavItem {
  moduleKey: FeatureKey;
  label: string;
  href: string;
  icon: ComponentType;
  group: string;
}

export interface ResolvedNavItem extends NavItem {
  /** Real entitlement result from `hasFeature(organization, moduleKey)` —
   * NOT a hardcoded placeholder anymore (issue #4). A module can be
   * disabled either because the org isn't entitled to it, or (today, Phase
   * 0/1) because it simply hasn't shipped yet — see lib/rbac/features.ts. */
  enabled: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { moduleKey: "dashboard", label: "Dashboard", href: "/", icon: LayoutDashboard, group: "Overview" },
  { moduleKey: "clients", label: "Clients", href: "/clients", icon: Users, group: "Operations" },
  { moduleKey: "assets", label: "Assets", href: "/assets", icon: Boxes, group: "Operations" },
  { moduleKey: "contracts", label: "Contracts", href: "/contracts", icon: FileText, group: "Operations" },
  // Articles / "Artikel database" (issue #92) — product/parts catalog
  // (articles, article_groups, article_components). `icon: Boxes` is reused
  // from Assets above: this icon set (packages/ui/src/icons.tsx) has no
  // dedicated package/tag icon, and `Boxes` is the only box-shaped icon
  // offered — reusing it here rather than inventing a new icon name.
  { moduleKey: "articles", label: "Articles", href: "/articles", icon: Boxes, group: "Operations" },
  // Route is `/work-orders` (the Work Order entity, issue #13) rather than
  // `/planning` — the fuller multi-view (list/kanban/calendar/map,
  // drag-and-drop) Planning/Dispatch board named in docs/ROADMAP.md is
  // separate, larger, follow-on work that may claim `/planning` later.
  // `moduleKey`/entitlement stays `planning` either way (that's the feature
  // key + RBAC matrix row both already use).
  { moduleKey: "planning", label: "Work Orders", href: "/work-orders", icon: CalendarDays, group: "Operations" },
  // Quotes / Estimates (issue #16, third stage — frontend). `moduleKey`
  // matches the `quotes` feature key/RBAC module both already registered in
  // lib/rbac/features.ts / lib/rbac/permissions.ts.
  { moduleKey: "quotes", label: "Quotes", href: "/quotes", icon: ClipboardList, group: "Operations" },
  // Activities / "Meldingen" (issue #59) — the ticket-like entity that
  // precedes a Work Order (call-back, storing, onderhoud, afspraak, e-mail
  // opvolging). `moduleKey`/label are Dutch throughout this domain, matching
  // the "Facturatie" precedent for billing. Grouped with the other
  // operational entities that precede/feed a Work Order (Clients/Assets/
  // Contracts/Work Orders), not "Insights".
  { moduleKey: "activities", label: "Meldingen", href: "/activities", icon: Bell, group: "Operations" },
  { moduleKey: "reporting", label: "Reporting", href: "/reporting", icon: BarChart3, group: "Insights" },
  { moduleKey: "billing", label: "Facturatie", href: "/billing", icon: Receipt, group: "Insights" },
  // Everyone can *view* Settings (read-only for non-owners — see
  // `lib/rbac/permissions.ts`'s `settings` entry); the module itself is
  // gated only on entitlement (`hasFeature`) like every other nav item, not
  // on role, same as e.g. Clients showing up for every tenant role.
  { moduleKey: "settings", label: "Settings", href: "/settings", icon: Settings, group: "Admin" },
  // Platform (issue #45) — Platform Admin's own cross-tenant settings stub.
  // Own new `group` ("Platform"), placed last, per this file's
  // group-by-consecutive-adjacency mechanism (no separate groups config).
  // `enabled` is NOT resolved via `hasFeature()` like every item above —
  // see the `moduleKey === "platform"` special case in `resolveNavItems`
  // below.
  { moduleKey: "platform", label: "Platform settings", href: "/platform-settings", icon: ShieldCheck, group: "Platform" },
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
 * `enabled: false` in that case (see `hasFeature`), EXCEPT the "Platform
 * settings" item (`moduleKey === "platform"`), which is a platform-wide
 * concern that has nothing to do with tenant entitlement — `hasFeature`
 * always returns `false` when `organization` is `null`, which is exactly
 * the account shape (platform-admin-only, no tenant membership) this item
 * needs to work for. That one item is special-cased below to resolve
 * `enabled` from `isPlatformAdmin` instead of `hasFeature`; every other
 * item's resolution is unchanged.
 */
export async function resolveNavItems(
  organization: FeatureOrganization | null,
  isPlatformAdmin = false,
): Promise<ResolvedNavItem[]> {
  return Promise.all(
    NAV_ITEMS.map(async (item) => ({
      ...item,
      enabled:
        item.moduleKey === "platform" ? isPlatformAdmin : await hasFeature(organization, item.moduleKey),
    })),
  );
}
