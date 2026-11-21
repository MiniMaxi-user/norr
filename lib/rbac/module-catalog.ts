/**
 * Module catalog (#244): which modules exist, which are core (always on) vs
 * add-on (switchable per tenant), their dependencies and whether they are
 * shipped. UI source of truth; pure and client-safe (no "server-only").
 *
 * KEEP IN SYNC with the DB table `feature_catalog` (enforcement source,
 * migration 20261126100000_organization_features_and_module_catalog.sql) and
 * `SHIPPED_FEATURES` in lib/rbac/features.ts. A vitest test pins this list.
 *
 * Not in the catalog: `reporting`, `billing` (not built) and `platform`
 * (platform-admin special case).
 */
import type { FeatureKey } from "./features";

export type CatalogFeatureKey = Extract<
  FeatureKey,
  | "dashboard"
  | "clients"
  | "assets"
  | "articles"
  | "activities"
  | "planning"
  | "settings"
  | "contracts"
  | "quotes"
  | "invoicing"
  | "checklists"
  | "inventory"
  | "meters"
  | "preventive_maintenance"
>;

export type ModuleTier = "core" | "addon";

export interface ModuleDefinition {
  label: string;
  description: string;
  tier: ModuleTier;
  /** Add-ons that must be enabled for this one to be enabled. */
  requires: CatalogFeatureKey[];
  shipped: boolean;
}

/** Declaration order is the display order within each tier. */
export const MODULE_CATALOG: Record<CatalogFeatureKey, ModuleDefinition> = {
  dashboard: {
    label: "Dashboard",
    description: "Overview of open work, planning and key figures.",
    tier: "core",
    requires: [],
    shipped: true,
  },
  clients: {
    label: "Clients",
    description: "Clients, sites and contacts.",
    tier: "core",
    requires: [],
    shipped: true,
  },
  assets: {
    label: "Assets",
    description: "Assets and asset models installed at your clients' sites.",
    tier: "core",
    requires: [],
    shipped: true,
  },
  articles: {
    label: "Articles",
    description: "Article database with groups, components and prices.",
    tier: "core",
    requires: [],
    shipped: true,
  },
  activities: {
    label: "Activities",
    description: "Activities that group the work for a client.",
    tier: "core",
    requires: [],
    shipped: true,
  },
  planning: {
    label: "Planning",
    description: "Work orders, planning, the field app and work receipts.",
    tier: "core",
    requires: [],
    shipped: true,
  },
  settings: {
    label: "Settings",
    description: "Organization settings, reference lists and numbering.",
    tier: "core",
    requires: [],
    shipped: true,
  },
  contracts: {
    label: "Contracts",
    description: "Service contracts with lines, linked assets and contract pricing.",
    tier: "addon",
    requires: [],
    shipped: true,
  },
  quotes: {
    label: "Quotes",
    description: "Quotes with line items, sent to and approved by clients.",
    tier: "addon",
    requires: [],
    shipped: true,
  },
  invoicing: {
    label: "Invoicing",
    description: "Invoices, payments and credit notes created from quotes.",
    tier: "addon",
    requires: ["quotes"],
    shipped: true,
  },
  checklists: {
    label: "Checklists",
    description: "Checklist templates and checklists completed on work orders.",
    tier: "addon",
    requires: [],
    shipped: true,
  },
  inventory: {
    label: "Inventory",
    description: "Warehouses, stock levels and stock deduction on work orders.",
    tier: "addon",
    requires: [],
    shipped: true,
  },
  meters: {
    label: "Meters",
    description: "Counters per asset model, readings and counter settlement on contracts.",
    tier: "addon",
    requires: [],
    shipped: true,
  },
  preventive_maintenance: {
    label: "Preventive maintenance",
    description: "Recurring maintenance schedules that generate work orders from contracts.",
    tier: "addon",
    requires: ["contracts", "planning"],
    shipped: false,
  },
};

export const CATALOG_KEYS = Object.keys(MODULE_CATALOG) as CatalogFeatureKey[];

export function isCatalogKey(key: string): key is CatalogFeatureKey {
  return Object.prototype.hasOwnProperty.call(MODULE_CATALOG, key);
}

export function coreModules(): CatalogFeatureKey[] {
  return CATALOG_KEYS.filter((k) => MODULE_CATALOG[k].tier === "core");
}

export function addonModules(): CatalogFeatureKey[] {
  return CATALOG_KEYS.filter((k) => MODULE_CATALOG[k].tier === "addon");
}

/** Direct dependents: modules that list `key` in their `requires`. */
export function dependentsOf(key: CatalogFeatureKey): CatalogFeatureKey[] {
  return CATALOG_KEYS.filter((k) => MODULE_CATALOG[k].requires.includes(key));
}

/** Direct requirements of `key`. */
export function requiredBy(key: CatalogFeatureKey): CatalogFeatureKey[] {
  return [...MODULE_CATALOG[key].requires];
}

export interface ToggleCascade {
  /** Change set to send in one go: the toggled key plus every cascaded key. */
  changes: Partial<Record<CatalogFeatureKey, boolean>>;
  /** Keys changed besides the toggled one (for the confirm popup). */
  affected: CatalogFeatureKey[];
  /** Set when the toggle is not allowed; `changes` is then empty. */
  error: string | null;
}

/**
 * Computes the change set for switching `key` on/off given the currently
 * enabled keys. Enabling pulls in every missing (transitive) requirement;
 * disabling pushes out every enabled (transitive) dependent. Mirrors the DB
 * validation: core can't be disabled, non-shipped can't be enabled.
 */
export function cascadeForToggle(
  current: ReadonlySet<string>,
  key: CatalogFeatureKey,
  enabled: boolean,
): ToggleCascade {
  const refuse = (error: string): ToggleCascade => ({ changes: {}, affected: [], error });
  const def = MODULE_CATALOG[key];

  if (enabled === current.has(key)) return { changes: {}, affected: [], error: null };

  if (!enabled && def.tier === "core") {
    return refuse(`${def.label} is a core module and can't be disabled`);
  }

  const affected: CatalogFeatureKey[] = [];
  const visited = new Set<CatalogFeatureKey>([key]);
  const queue: CatalogFeatureKey[] = [key];

  while (queue.length > 0) {
    const next = queue.shift()!;
    const related = enabled ? requiredBy(next) : dependentsOf(next);
    for (const rel of related) {
      if (visited.has(rel) || current.has(rel) === enabled) continue;
      visited.add(rel);
      affected.push(rel);
      queue.push(rel);
    }
  }

  if (enabled) {
    for (const k of [key, ...affected]) {
      if (!MODULE_CATALOG[k].shipped) {
        return refuse(`${MODULE_CATALOG[k].label} isn't available yet`);
      }
    }
  }

  const changes: Partial<Record<CatalogFeatureKey, boolean>> = { [key]: enabled };
  for (const k of affected) changes[k] = enabled;
  return { changes, affected, error: null };
}
