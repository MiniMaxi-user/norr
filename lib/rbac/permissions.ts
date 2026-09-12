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
 *
 * The actual implementation now lives in the `@yourorg/rbac` workspace
 * package (packages/rbac/src/permissions.ts), so both this app and
 * apps/pwa import the identical logic — this file is a thin re-export
 * shim so every existing `@/lib/rbac/permissions` import keeps working
 * unchanged.
 */
export * from "@yourorg/rbac";
