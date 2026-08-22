# Architecture

## Interpretation of roles — confirm before Phase 1
Two-level tenancy:
- **Platform Admin**: operates the SaaS, manages tenant organizations, billing, cross-tenant analytics.
- **Tenant roles** (inside one organization = one "Client"): `owner` (full access), `planner`, `engineer`, `finance`, `administratie`.

The **Clients module is the tenant's own customer records** (their CRM) — not the tenant itself. If this is wrong, flag it before Phase 1 starts: it changes the schema.

## Stack
- Next.js 15 (App Router, Server Components by default), TypeScript strict
- Supabase: Postgres, Auth (email/password + magic link, SSO later), Storage, Row Level Security
- Stripe: Billing (subscriptions, per-module price items), webhooks → entitlements
- Vercel: hosting, preview deployment per PR
- Design system: separate repo, published as a private package `@yourorg/ui`, consumed as a normal dependency

## Multi-tenancy & data isolation
- `organizations` = tenants
- `platform_admins` — separate from tenant roles (e.g. `users.is_platform_admin boolean`), never assignable through tenant-facing invite flows
- `memberships (user_id, organization_id, role)` — role enum: `owner | planner | engineer | finance | administratie`
- Every tenant-scoped table carries `organization_id`. RLS policy pattern — implemented (see `supabase/migrations/20260822150910_organizations_memberships_baseline_rls.sql`) via a `SECURITY DEFINER` helper function rather than an inline scalar subquery:

```sql
-- Helper (defined once, in the baseline migration). SECURITY DEFINER lets it
-- read `memberships` bypassing RLS, which is what avoids "infinite
-- recursion detected in policy" when used inside memberships' own policies,
-- and also avoids "more than one row returned by a subquery" if a user is
-- ever a member of more than one organization (a plain scalar-equality
-- subquery breaks in that case).
create or replace function public.is_member_of_org(org_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = org_id and m.user_id = auth.uid()
  );
$$;

-- Every tenant-scoped table's policy:
create policy "org_isolation" on assets
  using (is_member_of_org(organization_id));
```

  Use `is_member_of_org(organization_id)` (and, where a write should be owner-only, `is_org_owner(organization_id)`) in every new tenant-scoped table's RLS policies — don't re-derive membership with an inline subquery.
- No client-side query ever bypasses RLS. Server actions run under the user's session. The service-role key is used only in trusted server-only contexts (billing webhook sync, audited platform-admin cross-tenant reads). Platform Admin cross-tenant reads are **not** implemented as an RLS bypass policy for `is_platform_admin` users — they go through `lib/supabase/admin.ts` (service-role) from trusted server code only, audited in application code.

### Auth flows — implemented (issue #3)
- `lib/auth/session.ts`: `getCurrentSession()` / `requireSession()` resolve the signed-in user, their `is_platform_admin` flag, and their (first) organization + tenant role in one place, under the caller's own session. `app/(app)/layout.tsx` calls `requireSession()` to gate the entire authenticated route group (redirects to `/login` when signed out); nothing else under `app/(app)` needs its own "is anyone signed in" check.
- `lib/auth/actions.ts`: Server Actions for signup, login, logout, invite creation, and invite redemption — all via `lib/supabase/server.ts` (never `admin.ts`). This Supabase project requires email confirmation (`mailer_autoconfirm: false`), so a brand-new signup has no session in the same request; organization/owner bootstrap is deferred to that user's first successful login (see `ensureOwnOrganizationBootstrapped` — carries the org name through via Supabase user metadata across the confirmation round trip).
- `app/(auth)/{login,signup,invite/[token]}`: route group without the `AppShell` chrome (sibling to `app/(app)`), using `@yourorg/ui` form primitives (`Input`/`Label`, added to the temporary stub — see `vendor/yourorg-ui-stub`).
- Invite mechanism: see the `invites` table entry under "Core schema (v1)" above.

## Core schema (v1)
- `organizations`, `memberships`, `users` (Supabase `auth.users` + profile table) — **implemented** in `supabase/migrations/20260822150910_organizations_memberships_baseline_rls.sql`:
  - `users (id uuid pk references auth.users, email, full_name, is_platform_admin boolean default false, created_at, updated_at)` — profile row auto-created by an `on auth.users insert` trigger; `authenticated` only has column-level UPDATE grant on `full_name` (never `is_platform_admin`/`email`/`id`), so no client path can self-elevate to platform admin.
  - `organizations (id uuid pk, name, slug unique, created_by references users, created_at, updated_at)` — visible to its creator (`created_by = auth.uid()`) even before any membership exists (needed for `INSERT ... RETURNING` during signup bootstrap), and to any member thereafter.
  - `memberships (id uuid pk, user_id references users, organization_id references organizations, role membership_role not null, created_at, updated_at, unique(user_id, organization_id))` — `role` enum: `owner | planner | engineer | finance | administratie`.
  - Bootstrapping (first org + first owner membership on signup): a user may self-insert an `owner` membership into an organization only if (a) they created that organization and (b) it has zero existing members. After that, only existing `owner` members can insert further memberships — this is the hook the invite flow (issue #3/#4) should use.
- `clients` (organization_id, name, ...) — the tenant's own customers
- `sites` (client_id, address, geo)
- `assets` (site_id, client_id, type, serial_number, installed_at, warranty_until)
- `contracts` (client_id, type, start_date, end_date, billing_terms, sla)
- `contract_assets` (join table)
- `work_orders` (organization_id, client_id, asset_id, contract_id, assigned_to, status, scheduled_at)
- `reports` (work_order_id, pdf_url, generated_at)
- `invoices` (organization_id, client_id, amount, status) — the tenant's own invoicing to its clients
- `invites (id, organization_id, email, role, invited_by, token, expires_at, accepted_at, created_at)` — **implemented** in `supabase/migrations/20260822180000_invites.sql`, issue #3/#4. Lets an existing `owner` invite an email address that has no `auth.users` row yet: `token` is an unguessable capability looked up (pre-auth) via the `get_invite_by_token(token)` SECURITY DEFINER function, and redeemed into a real `memberships` row post-auth via the `redeem_invite(token)` SECURITY DEFINER function, which enforces that the redeeming account's own email matches the invite's email. `role` reuses `membership_role` (no `platform_admin` value), so Platform Admin access is structurally unreachable through this flow.
- `organization_features` (organization_id, feature_key, enabled) — entitlements
- `subscriptions` (organization_id, stripe_customer_id, stripe_subscription_id, plan)
- `audit_log` (organization_id, actor_id, action, entity, at)

## RBAC matrix — starting point

| Module | Owner | Planner | Engineer | Finance | Administratie | Platform Admin |
|---|---|---|---|---|---|---|
| Clients | CRUD | Read | Read (assigned) | Read | Read | Read (support only) |
| Assets | CRUD | Read/Update | Read/Update (assigned) | Read | Read | Read |
| Contracts | CRUD | Read | Read | CRUD | Read | Read |
| Planning | CRUD | CRUD | Read/Update own | Read | Read | — |
| Reporting | Read | Read | Create (own work orders) | Read | Read | Cross-tenant |
| Dashboarding | Configure | View | View (own) | View | View | Cross-tenant |
| Billing/Facturatie | Read | — | — | CRUD | CRUD | Platform billing only |

Encode this as a single config object (`lib/rbac/permissions.ts`), not scattered `if (role === ...)` checks. Enforce it both server-side and in RLS.

**Implemented** (issue #4): `lib/rbac/permissions.ts` encodes the table above verbatim as `TENANT_PERMISSIONS` (+ a `PLATFORM_ADMIN_PERMISSIONS` column), exposing `can(actor, module, action)`, `canAny(...)`, `allowedActions(...)`, and `canAccessModule(...)`. `actor: { role: TenantRole | null; isPlatformAdmin?: boolean }` keeps Platform Admin as an orthogonal flag, never a `TenantRole` member, per the rule above. `_own`-suffixed actions (`create_own`/`read_own`/`update_own`) mark matrix cells like "Read (assigned)"/"Read/Update own" — callers must still apply the actual resource-ownership filter themselves; `can()` only tells you the verb is allowed at all.

## Feature flags
- `organization_features` drives UI + API gating
- Stripe webhook (`customer.subscription.updated`) syncs entitlements → `organization_features`
- Platform Admin UI can override per tenant (trials, custom deals) — logged in `audit_log`
- Every module route/component checks entitlement via one helper — `hasFeature(organization, featureKey)` — never hardcode module availability

**Implemented (Phase 0 stub, issue #4):** `lib/rbac/features.ts` exports `hasFeature(organization, featureKey)` with the real call signature (`organization: { id }`, async) already wired everywhere a module gate is needed (`components/shell/nav-items.ts` → `resolveNavItems`, threaded down to the sidebar and command palette). Since `organization_features` doesn't exist until Phase 3, the current implementation ignores `organization` and returns `true` only for feature keys with a shipped implementation (today: `dashboard`). Swapping in the real `organization_features` query (documented inline as a TODO in that file) is the only change needed once Phase 3 lands — no call site should need to change.

## Premium UX requirements
- Collapsible sidebar (persisted per user), command palette, optimistic mutations
- View switcher per module: list / kanban / calendar / map (Assets, Planning)
- Skeleton loading, not spinners; route-level streaming (Suspense)
- Design tokens and components come exclusively from `@yourorg/ui` — no ad-hoc styling in the app repo

## Design system consumption
The main app installs the design-system package as a normal npm dependency (private registry, e.g. GitHub Packages). Fixes go upstream in the design-system repo — never forked locally.
