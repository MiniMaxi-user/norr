/**
 * Single source of truth for RBAC (issue #4). Encodes the matrix from
 * docs/ARCHITECTURE.md ("RBAC matrix — starting point") as data, not
 * scattered `if (role === "planner")` checks.
 *
 * CLAUDE.md rule 2: "Permissions are checked through
 * lib/rbac/permissions.ts — never inline `if (role === 'planner')` checks."
 * Every server action / route handler / RLS-adjacent server helper that
 * needs to know "can this actor do X to module Y" should call `can()` (or
 * `canAny()`) from here instead of re-deriving it.
 *
 * This is an *application-level* authorization layer — it is a second line
 * of defense, not a replacement for RLS. RLS (see the migrations under
 * supabase/migrations/) is what actually enforces tenant isolation at the
 * database; `can()` is what UI/server-action code uses to decide whether to
 * even attempt an operation (and to hide/disable controls), and to enforce
 * "own resource" scoping that plain RLS org-membership checks don't express
 * (e.g. an engineer only touching their *assigned* work).
 */

/** Tenant-scoped roles — mirrors the Postgres `membership_role` enum
 * (supabase/migrations/20260822150910_organizations_memberships_baseline_rls.sql).
 * Platform Admin is intentionally NOT a member of this union: per
 * docs/ARCHITECTURE.md and CLAUDE.md, `is_platform_admin` is a separate,
 * cross-tenant flag that must never be assignable through a tenant role /
 * invite flow. It's modeled as its own field on `PermissionActor` below. */
export type TenantRole = "owner" | "planner" | "engineer" | "finance" | "administratie";

export const TENANT_ROLES: readonly TenantRole[] = [
  "owner",
  "planner",
  "engineer",
  "finance",
  "administratie",
] as const;

export function isTenantRole(value: string): value is TenantRole {
  return (TENANT_ROLES as readonly string[]).includes(value);
}

/** Modules from the docs/ARCHITECTURE.md RBAC matrix. Deliberately the same
 * string keys as `moduleKey` in components/shell/nav-items.ts and as
 * `FeatureKey` in lib/rbac/features.ts — permissions (can this role act on
 * this module) and entitlements (is this org paying for this module) are
 * different concerns that happen to share a key today. Don't assume they'll
 * always be 1:1 (a role can lack permission on a module the org *is*
 * entitled to, e.g. Planner has no Billing access at all). */
export type Module =
  | "clients"
  | "assets"
  | "contracts"
  | "planning"
  | "checklists"
  | "quotes"
  | "activities"
  | "reporting"
  | "dashboard"
  | "billing"
  | "settings"
  | "platform";

/**
 * Actions a role can be granted on a module. The `_own` suffix actions
 * (`create_own` / `read_own` / `update_own`) correspond to matrix cells like
 * "Read (assigned)" / "Read/Update own" / "Create (own work orders)" — they
 * mean the actor may act on resources scoped to them specifically (e.g.
 * `assigned_to = auth.uid()` or `work_orders.created_by = auth.uid()`), NOT
 * on every row in the module. Callers MUST apply that extra scoping
 * themselves (query filter) when `can()` returns true only for an `_own`
 * action and not the unscoped equivalent — `can()` only tells you the verb
 * is allowed at all, it doesn't (and can't, without a resource in hand)
 * enforce the ownership filter for you. Use `isSelfScoped()` below to check
 * whether that extra filtering is required.
 */
export type Action =
  | "create"
  | "read"
  | "update"
  | "delete"
  | "configure"
  | "create_own"
  | "read_own"
  | "update_own";

export function isSelfScoped(action: Action): boolean {
  return action.endsWith("_own");
}

const CRUD: readonly Action[] = ["create", "read", "update", "delete"] as const;
const READ_ONLY: readonly Action[] = ["read"] as const;
const READ_UPDATE: readonly Action[] = ["read", "update"] as const;
const NONE: readonly Action[] = [] as const;

/**
 * The RBAC matrix, transcribed 1:1 from docs/ARCHITECTURE.md. Keep these in
 * sync — if you change one, change the other in the same PR.
 *
 * | Module     | Owner | Planner | Engineer            | Finance | Administratie |
 * |------------|-------|---------|----------------------|---------|----------------|
 * | Clients    | CRUD  | Read    | Read (assigned)      | Read    | Read           |
 * | Assets     | CRUD  | R/U     | Read/Update (assigned)| Read   | Read           |
 * | Contracts  | CRUD  | Read    | Read                 | CRUD    | Read           |
 * | Planning   | CRUD  | CRUD    | Read/Update/Create own| Read   | Read           |
 * | Checklists | CRUD  | CRUD    | Read/Update own      | Read    | Read           |
 * | Quotes     | CRUD  | CRUD    | Read                 | Read    | Read           |
 * | Activities | CRUD  | CRUD    | Create/Read/Update own| Read   | Read           |
 * | Reporting  | Read  | Read    | Create (own WOs)     | Read    | Read           |
 * | Dashboard  | Config| View    | View (own)           | View    | View           |
 * | Billing    | Read  | —       | —                    | CRUD    | CRUD           |
 *
 * `settings` (below) is NOT part of the docs/ARCHITECTURE.md matrix above —
 * it's a small, mechanical extension added alongside the reference-lists
 * feature (tenant-configurable picklists: Asset Type/Status today, Contract
 * Type etc. later — see docs/ARCHITECTURE.md "Tenant-configurable reference
 * data" and `lib/reference-lists/actions.ts`). Modeled the same shape as
 * every other module rather than inventing a bespoke check, since the DB
 * RLS boundary on `reference_lists`/`reference_list_items` is exactly
 * "owner CRUD, everyone else read" (see
 * supabase/migrations/20260822200000_reference_lists.sql) — the same
 * pattern as `clients`/`sites`/`assets`. Flagged here for
 * `auth-rbac-engineer` to fold into docs/ARCHITECTURE.md's matrix table
 * properly / reconsider naming, rather than silently treated as a
 * permanent decision.
 */
const TENANT_PERMISSIONS: Record<Module, Record<TenantRole, readonly Action[]>> = {
  clients: {
    owner: CRUD,
    planner: READ_ONLY,
    engineer: ["read_own"],
    finance: READ_ONLY,
    administratie: READ_ONLY,
  },
  assets: {
    owner: CRUD,
    planner: READ_UPDATE,
    engineer: ["read_own", "update_own"],
    finance: READ_ONLY,
    administratie: READ_ONLY,
  },
  contracts: {
    owner: CRUD,
    planner: READ_ONLY,
    engineer: READ_ONLY,
    finance: CRUD,
    administratie: READ_ONLY,
  },
  planning: {
    owner: CRUD,
    planner: CRUD,
    // create_own added for issue #15 (Time Tracking on Work Orders):
    // engineer can log/clock in their OWN time (time_entries, a sub-resource
    // of Work Orders under this same module — see
    // supabase/migrations/20260823180000_time_entries_core.sql), but this
    // does NOT grant plain `create` — an engineer still cannot create Work
    // Orders themselves, that stays owner/planner only.
    engineer: ["read_own", "update_own", "create_own"],
    finance: READ_ONLY,
    administratie: READ_ONLY,
  },
  // Checklists (issue #14, second stage): a Work Order sub-resource
  // (`work_order_checklists`/`work_order_checklist_items`,
  // supabase/migrations/20260823210000_checklists_core.sql), but modeled as
  // its OWN module rather than folded into `planning` per that migration's
  // explicit flag (docs/ARCHITECTURE.md's "Checklists" RBAC note): `planning`'s
  // engineer row was widened to `create_own` for Time Tracking (issue #15),
  // and reusing it here would incorrectly suggest an engineer can create a
  // checklist instance too — the RLS above does not allow that (creating an
  // instance is owner/planner only, matching Work Orders' OWN create
  // boundary, not Time Entries' carve-out). This row is deliberately the
  // ORIGINAL Work-Orders-era shape: engineer gets read_own/update_own only
  // (they can check off items on their own assigned checklist) and no
  // create/delete at all.
  checklists: {
    owner: CRUD,
    planner: CRUD,
    engineer: ["read_own", "update_own"],
    finance: READ_ONLY,
    administratie: READ_ONLY,
  },
  // Quotes (issue #16, second stage): a new top-level module (pre-sale
  // proposal builder), reusing `work_orders`' exact CRUD shape — owner AND
  // planner both get full CRUD (unlike `contracts`' owner+finance pairing,
  // since a quote isn't yet revenue) — engineer/finance/administratie are
  // plain `read` (all rows, no `_own` scoping: a quote is a sales document
  // any team member can see, not assigned to one engineer). Matches
  // supabase/migrations/20260824090000_quotes_core.sql's RLS exactly.
  quotes: {
    owner: CRUD,
    planner: CRUD,
    engineer: READ_ONLY,
    finance: READ_ONLY,
    administratie: READ_ONLY,
  },
  // Activities (issue #59, "melding"): a NEW top-level module (a ticket-like
  // entity preceding a Work Order), a NEW shape — not a `planning` alias, per
  // the issue's explicit instruction — mirroring
  // supabase/migrations/20260828090000_activities_core.sql's RLS exactly:
  // owner/planner CRUD (all rows); engineer create_own/read_own/update_own
  // only, where "own" = `action_holder_id = auth.uid()` (no delete —
  // deliberately narrower than `planning`'s engineer row, which has no
  // create_own+read_own+update_own combined the same way, and unlike
  // `checklists`' engineer row, which has no create at all); finance/
  // administratie plain read (all rows, no `_own` scoping).
  activities: {
    owner: CRUD,
    planner: CRUD,
    engineer: ["create_own", "read_own", "update_own"],
    finance: READ_ONLY,
    administratie: READ_ONLY,
  },
  reporting: {
    owner: READ_ONLY,
    planner: READ_ONLY,
    engineer: ["create_own"],
    finance: READ_ONLY,
    administratie: READ_ONLY,
  },
  dashboard: {
    // "Configure" implies the owner can also just view — list both rather
    // than making callers infer it.
    owner: ["configure", "read"],
    planner: READ_ONLY,
    engineer: ["read_own"],
    finance: READ_ONLY,
    administratie: READ_ONLY,
  },
  billing: {
    owner: READ_ONLY,
    planner: NONE,
    engineer: NONE,
    finance: CRUD,
    administratie: CRUD,
  },
  settings: {
    owner: CRUD,
    planner: READ_ONLY,
    engineer: READ_ONLY,
    finance: READ_ONLY,
    administratie: READ_ONLY,
  },
  // Platform (issue #45): Platform Admin's own cross-tenant settings area
  // (app/(app)/platform-settings/page.tsx) — never a tenant-role concern
  // (docs/ARCHITECTURE.md / CLAUDE.md: `is_platform_admin` is a separate,
  // cross-tenant flag, never assignable through a tenant role/invite flow),
  // so every tenant role gets NONE here, same shape as e.g. `billing`'s
  // planner/engineer rows.
  platform: {
    owner: NONE,
    planner: NONE,
    engineer: NONE,
    finance: NONE,
    administratie: NONE,
  },
};

/**
 * Platform Admin column of the matrix. Platform Admin is cross-tenant and
 * read-mostly by design (docs/ARCHITECTURE.md: "Read (support only)" for
 * Clients, "Cross-tenant" read/view for Reporting/Dashboarding, "Platform
 * billing only" for Billing — i.e. explicitly NOT tenant billing). Actual
 * cross-tenant reads still must go through `lib/supabase/admin.ts`
 * (service-role, audited), never an RLS bypass — `can()` only answers the
 * authorization question, not which Supabase client to use.
 */
const PLATFORM_ADMIN_PERMISSIONS: Record<Module, readonly Action[]> = {
  clients: READ_ONLY,
  assets: READ_ONLY,
  contracts: READ_ONLY,
  planning: NONE,
  // No "Read (support only)"-style cross-tenant carve-out documented for
  // Checklists — same NONE shape as `planning`/`settings`.
  checklists: NONE,
  // No "Read (support only)"-style cross-tenant carve-out documented for
  // Quotes either (docs/ARCHITECTURE.md's RBAC matrix table shows "—" for
  // Quotes' Platform Admin column) — same NONE shape as `planning`/
  // `checklists`/`settings`.
  quotes: NONE,
  // No "Read (support only)"-style cross-tenant carve-out documented for
  // Activities either — same NONE shape as `planning`/`checklists`/`quotes`.
  activities: NONE,
  reporting: READ_ONLY,
  dashboard: READ_ONLY,
  billing: NONE,
  // Reference-list configuration is tenant-specific admin data, not a
  // cross-tenant Platform Admin concern (no "Read (support only)" carve-out
  // documented for it the way Clients has) — NONE, same shape as `planning`.
  settings: NONE,
  // Platform (issue #45): the only module Platform Admin gets on its own
  // account, matching `app/(app)/platform-settings/page.tsx`'s gate
  // (`canAccessModule(actor, "platform")`). Read-only per this file's own
  // "Platform Admin is ... read-mostly by design" convention — there's
  // nothing to configure yet (stub page).
  platform: READ_ONLY,
};

export interface PermissionActor {
  /** Tenant role for the organization the check is scoped to, or `null` if
   * the actor has no membership there (e.g. platform-admin-only account, or
   * signed-out — though signed-out callers shouldn't reach `can()` at all). */
  role: TenantRole | null;
  /** Cross-tenant Platform Admin flag (`users.is_platform_admin`). Never
   * derive this from `role` — it's an orthogonal axis. */
  isPlatformAdmin?: boolean;
}

/** Is `actor` allowed to perform `action` on `module`? */
export function can(actor: PermissionActor, module: Module, action: Action): boolean {
  if (actor.isPlatformAdmin && PLATFORM_ADMIN_PERMISSIONS[module].includes(action)) {
    return true;
  }
  if (actor.role && TENANT_PERMISSIONS[module][actor.role].includes(action)) {
    return true;
  }
  return false;
}

/** Is `actor` allowed to perform at least one of `actions` on `module`? */
export function canAny(actor: PermissionActor, module: Module, actions: readonly Action[]): boolean {
  return actions.some((action) => can(actor, module, action));
}

/** Every action `actor` is allowed on `module` (tenant role + platform admin
 * grants combined). Useful for building UI affordances without repeating
 * `can()` per action. */
export function allowedActions(actor: PermissionActor, module: Module): Action[] {
  const tenantActions = actor.role ? TENANT_PERMISSIONS[module][actor.role] : NONE;
  const platformActions = actor.isPlatformAdmin ? PLATFORM_ADMIN_PERMISSIONS[module] : NONE;
  return Array.from(new Set([...tenantActions, ...platformActions]));
}

/** Does `actor` have any access at all to `module` (any action)? Handy for
 * "should this even show up" checks distinct from feature-gating
 * (`hasFeature()` in `lib/rbac/features.ts`) — a module can be entitled to
 * the org but still off-limits to this particular role. */
export function canAccessModule(actor: PermissionActor, module: Module): boolean {
  return allowedActions(actor, module).length > 0;
}
