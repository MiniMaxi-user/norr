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
  Clock,
} from "@yourorg/ui/icons";
import { hasFeature, type FeatureKey, type FeatureOrganization } from "@/lib/rbac/features";
import { can, type Action, type Module, type PermissionActor } from "@/lib/rbac/permissions";

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
  /**
   * Extra RBAC gate beyond entitlement (`hasFeature`) — every other item
   * below only needs the org to be entitled to `moduleKey`; ANY role with
   * some access still sees the entry (existing "Soon"-badge disabled
   * treatment when not yet entitled). A route can also be genuinely
   * role-restricted rather than just permission-scoped once inside it —
   * e.g. the Planning scheduler board (issue #164) is owner/planner only,
   * while the sibling Work Orders entry shares the exact same `planning`
   * moduleKey/entitlement but stays visible to every role. When set,
   * `resolveNavItems` requires `can(actor, requiredPermission.module,
   * requiredPermission.action)` for the item to be included in the
   * resolved list AT ALL (not merely disabled) — matching this app's
   * "a module/view that isn't entitled must not render" convention
   * (CLAUDE.md rule 3), applied here to a role gate instead of a tenant
   * entitlement gate. Omitted (undefined) for every other item, which
   * keeps their existing hasFeature()-only resolution unchanged.
   */
  requiredPermission?: { module: Module; action: Action };
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
  // Planning (issue #164) — the drag-and-drop dispatcher/scheduler board,
  // the fuller multi-view Planning/Dispatch board `moduleKey: "planning"`'s
  // own comment (below, on the Work Orders entry) anticipated as follow-on
  // work. Shares the exact same `planning` moduleKey/FeatureKey/RBAC module
  // as Work Orders (both are already reserved for this build — see
  // `lib/rbac/permissions.ts`/`lib/rbac/features.ts`), but is owner/planner
  // ONLY in practice: `requiredPermission` requires the FULL `update` action
  // (not `update_own`, which an engineer also holds on this module for their
  // own assigned work) so an engineer never sees this entry at all, while
  // still seeing the Work Orders entry right below for their own assignments.
  {
    moduleKey: "planning",
    label: "Planning",
    href: "/planning",
    icon: Clock,
    group: "Operations",
    requiredPermission: { module: "planning", action: "update" },
  },
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
 *
 * `actor` (issue #164) drives the second, independent `requiredPermission`
 * gate on `NavItem` — unlike `enabled` (disabled-with-a-"Soon"-badge for a
 * not-yet-entitled module), an item whose `requiredPermission` check fails
 * is dropped from the returned array ENTIRELY, not merely marked disabled:
 * per CLAUDE.md rule 3, a role-restricted view "must not render, not just
 * be disabled." `actor` is optional (undefined) only for callers that
 * genuinely have no actor to check yet; every item with a
 * `requiredPermission` is excluded whenever `actor` is absent, same as an
 * unresolvable permission check.
 */
export async function resolveNavItems(
  organization: FeatureOrganization | null,
  isPlatformAdmin = false,
  actor?: PermissionActor,
): Promise<ResolvedNavItem[]> {
  const resolved = await Promise.all(
    NAV_ITEMS.map(async (item) => ({
      ...item,
      enabled:
        item.moduleKey === "platform" ? isPlatformAdmin : await hasFeature(organization, item.moduleKey),
    })),
  );
  return resolved.filter((item) => {
    if (!item.requiredPermission) return true;
    return actor ? can(actor, item.requiredPermission.module, item.requiredPermission.action) : false;
  });
}
