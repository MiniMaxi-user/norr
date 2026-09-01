import { Boxes, CalendarDays, ClipboardList, CreditCard, FileText, Mail, Receipt, Users, type Icon } from "@yourorg/ui/icons";
import { REFERENCE_LIST_SECTIONS } from "../reference-lists/sections";

/**
 * Single source of truth for the Settings admin shell's grouped left rail
 * (issue #110) — drives both `SettingsShell`'s nav rail and the topbar
 * breadcrumb label lookup for whichever leaf route is active, the same
 * "one config, two consumers" pattern `components/shell/nav-items.ts`
 * already uses for the primary sidebar + command palette.
 *
 * Titles for reference-list-backed items are pulled from
 * `REFERENCE_LIST_SECTIONS` (`../reference-lists/sections.ts`) via
 * `findTitle` below rather than re-typed here, so the two never drift.
 */
export interface SettingsNavItem {
  key: string;
  label: string;
  href: string;
}

export interface SettingsNavGroup {
  label: string;
  icon: Icon;
  items: SettingsNavItem[];
}

/**
 * Looks up a reference-list section's display title by its `list_key`. Every
 * key passed here must exist in `REFERENCE_LIST_SECTIONS` — a missing one
 * throws immediately (at module load, not silently mislabeling a nav entry)
 * so a future rename/removal of a section can't drift out of sync unnoticed.
 */
function findTitle(key: string): string {
  const section = REFERENCE_LIST_SECTIONS.find((candidate) => candidate.key === key);
  if (!section) {
    throw new Error(`settings-nav-items: no REFERENCE_LIST_SECTIONS entry for "${key}"`);
  }
  return section.title;
}

export const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  {
    label: "Assets",
    icon: Boxes,
    items: [
      { key: "asset_type", label: findTitle("asset_type"), href: "/settings/reference-lists/asset_type" },
      { key: "asset_status", label: findTitle("asset_status"), href: "/settings/reference-lists/asset_status" },
      { key: "asset_subtype", label: findTitle("asset_subtype"), href: "/settings/reference-lists/asset_subtype" },
      { key: "asset_brand", label: findTitle("asset_brand"), href: "/settings/reference-lists/asset_brand" },
      { key: "asset_models", label: "Asset Model", href: "/settings/asset-models" },
    ],
  },
  {
    label: "Work Orders",
    icon: CalendarDays,
    items: [
      {
        key: "work_order_status",
        label: findTitle("work_order_status"),
        href: "/settings/reference-lists/work_order_status",
      },
      {
        key: "work_order_priority",
        label: findTitle("work_order_priority"),
        href: "/settings/reference-lists/work_order_priority",
      },
    ],
  },
  {
    label: "Contracts",
    icon: FileText,
    items: [
      { key: "contract_type", label: findTitle("contract_type"), href: "/settings/reference-lists/contract_type" },
      { key: "sla_tier", label: findTitle("sla_tier"), href: "/settings/reference-lists/sla_tier" },
      { key: "billing_terms", label: findTitle("billing_terms"), href: "/settings/reference-lists/billing_terms" },
    ],
  },
  {
    label: "Quotes",
    icon: Receipt,
    items: [{ key: "quote_status", label: findTitle("quote_status"), href: "/settings/reference-lists/quote_status" }],
  },
  {
    label: "Contacts",
    icon: Mail,
    items: [{ key: "contact_role", label: findTitle("contact_role"), href: "/settings/reference-lists/contact_role" }],
  },
  {
    label: "Articles",
    icon: Boxes,
    items: [
      { key: "article_unit", label: findTitle("article_unit"), href: "/settings/reference-lists/article_unit" },
      {
        key: "article_manufacturer",
        label: findTitle("article_manufacturer"),
        href: "/settings/reference-lists/article_manufacturer",
      },
      { key: "vat_rate", label: findTitle("vat_rate"), href: "/settings/reference-lists/vat_rate" },
      { key: "article_groups", label: "Article Groups", href: "/settings/article-groups" },
    ],
  },
  {
    label: "Templates",
    icon: ClipboardList,
    items: [{ key: "checklist_templates", label: "Checklist Templates", href: "/settings/checklist-templates" }],
  },
  {
    // Issue #109 — org-level fallback billing rates (layer 3 of
    // `resolve_billing_rate`'s 4-layer precedence). Its own small group
    // rather than folded into "Articles": the two default Travel/Work
    // articles are a billing-rate *setting*, not an article catalog entry —
    // same "own group" treatment "Templates" gets for the same reason.
    label: "Billing",
    icon: CreditCard,
    items: [{ key: "default_rates", label: "Default Rates", href: "/settings/default-rates" }],
  },
  {
    label: "People",
    icon: Users,
    items: [
      { key: "team", label: "Team", href: "/settings/team" },
      { key: "account_managers", label: "Account Managers", href: "/settings/account-managers" },
    ],
  },
];

interface FlatSettingsNavEntry {
  group: SettingsNavGroup;
  item: SettingsNavItem;
}

/**
 * Flattened once at module scope — every `SettingsNavItem` paired with the
 * `SettingsNavGroup` it belongs to — so `findSettingsNavItem`/
 * `getSettingsGroupIcon` below don't re-walk `SETTINGS_NAV_GROUPS` on every
 * call.
 */
const FLAT_SETTINGS_NAV_ITEMS: FlatSettingsNavEntry[] = SETTINGS_NAV_GROUPS.flatMap((group) =>
  group.items.map((item) => ({ group, item })),
);

/**
 * Resolves the current route to its nav group + item, e.g. for
 * `SettingsShell` to derive the active breadcrumb label and highlight the
 * matching rail entry. Matches on exact `href` — every settings leaf route
 * maps 1:1 to one nav entry, unlike the primary sidebar's
 * `startsWith`-based `ActiveNavItem` (no settings leaf route has its own
 * sub-routes today).
 */
export function findSettingsNavItem(pathname: string): FlatSettingsNavEntry | null {
  return FLAT_SETTINGS_NAV_ITEMS.find((entry) => entry.item.href === pathname) ?? null;
}

/**
 * Given a nav item's own `key` (not its href), returns the `Icon` of the
 * group it belongs to — lets a leaf page's own `SectionHeader` (later
 * stages) reuse "the same icon as my rail entry" without re-declaring which
 * icon that is.
 */
export function getSettingsGroupIcon(key: string): Icon | undefined {
  return FLAT_SETTINGS_NAV_ITEMS.find((entry) => entry.item.key === key)?.group.icon;
}
