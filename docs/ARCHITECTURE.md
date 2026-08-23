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
- Design system: `@yourorg/ui`, an npm workspace package living in this same repo at `packages/ui` (not a separate repo/registry) — see "Design system consumption" below

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
- `app/(auth)/{login,signup,invite/[token]}`: route group without the `AppShell` chrome (sibling to `app/(app)`), using `@yourorg/ui` form primitives (`Input`/`Label` — see `packages/ui`, "Design system consumption" below).
- Invite mechanism: see the `invites` table entry under "Core schema (v1)" above.

## Core schema (v1)
- `organizations`, `memberships`, `users` (Supabase `auth.users` + profile table) — **implemented** in `supabase/migrations/20260822150910_organizations_memberships_baseline_rls.sql`:
  - `users (id uuid pk references auth.users, email, full_name, is_platform_admin boolean default false, created_at, updated_at)` — profile row auto-created by an `on auth.users insert` trigger; `authenticated` only has column-level UPDATE grant on `full_name` (never `is_platform_admin`/`email`/`id`), so no client path can self-elevate to platform admin.
  - `organizations (id uuid pk, name, slug unique, created_by references users, created_at, updated_at)` — visible to its creator (`created_by = auth.uid()`) even before any membership exists (needed for `INSERT ... RETURNING` during signup bootstrap), and to any member thereafter.
  - `memberships (id uuid pk, user_id references users, organization_id references organizations, role membership_role not null, created_at, updated_at, unique(user_id, organization_id))` — `role` enum: `owner | planner | engineer | finance | administratie`.
  - Bootstrapping (first org + first owner membership on signup): a user may self-insert an `owner` membership into an organization only if (a) they created that organization and (b) it has zero existing members. After that, only existing `owner` members can insert further memberships — this is the hook the invite flow (issue #3/#4) should use.
- `clients`, `sites`, `assets` — **implemented** (issue #7) in `supabase/migrations/20260822190000_clients_sites_assets.sql`, tested in `supabase/tests/database/clients_sites_assets_rls.test.sql`:
  - `clients (id, organization_id, name, email, phone, address_line1, address_line2, postal_code, city, country, notes, created_by, created_at, updated_at)` — the tenant's own customer records (their CRM), not the tenant itself. `organization_id` is supplied directly by the inserting owner (checked by RLS, like `invites.organization_id`).
  - `sites (id, organization_id, client_id, name, address_line1, address_line2, postal_code, city, country, latitude, longitude, notes, created_by, created_at, updated_at)` — a client's physical location. `latitude`/`longitude` are plain `double precision` (no PostGIS dependency) — sufficient for map-view pins; revisit only if geospatial queries (radius search etc.) are actually needed.
  - `assets (id, organization_id, client_id, site_id, name, type_id, manufacturer, model, serial_number, status_id, installed_at date, warranty_until date, notes, created_by, created_at, updated_at)` — equipment installed at a site. `type_id`/`status_id` are FKs into `reference_list_items` (see "Tenant-configurable reference data" below) — **as of `20260822200000_reference_lists.sql`**, these replaced the original free-text `type` column and the original `asset_status` enum column (`'active'|'decommissioned'`), because a Postgres enum cannot gain a per-tenant value without a schema migration and free text has no governance at all. `status_id` defaults to the organization's default `asset_status` item when omitted on insert (same UX the old `default 'active'` had); `type_id` is required, no default, same as the old `type` column.
  - **`organization_id` denormalization decision**: `organizations -> clients -> sites -> assets` is a 2-3 hop chain. Rather than write RLS policies that join through `clients` (and, for `assets`, through `sites` *and* `clients`), both `sites` and `assets` carry their own `organization_id` column (and `assets` also carries `client_id`, denormalized from its `site_id`), so every tenant-scoped table keeps the same simple, single-column `is_member_of_org(organization_id)` / `is_org_owner(organization_id)` RLS policy shape — no in-policy joins, cheaper to plan. These denormalized columns are populated automatically by a `BEFORE INSERT/UPDATE OF <parent-fk>` trigger (`derive_site_organization_id`, `derive_asset_org_and_client`) and are **excluded from the client-facing column-level INSERT/UPDATE grants** (same lockdown pattern as `invites.token`/`accepted_at`) — callers must supply `client_id` (sites) / `site_id` (assets) only; the trigger derives and overwrites `organization_id`/`client_id` regardless of what's sent. The same triggers also reject any UPDATE that would re-parent a row across organizations (raises `23514`), since a plain RLS `USING`/`WITH CHECK` on `organization_id` alone can't express "and don't let this row move to a different tenant."
  - **Write RLS boundary (v1, deliberately coarse)**: SELECT is `is_member_of_org(organization_id)` (any role) on all three tables. INSERT/UPDATE/DELETE is `is_org_owner(organization_id)` only, on all three tables — this matches the RBAC matrix's "Owner: CRUD" column but does **not** yet implement Planner's "Read/Update" or Engineer's "Read/Update (assigned)" on Assets at the RLS layer; that finer split is an application-layer (`lib/rbac/permissions.ts`) concern until Phase 2's assignment-based scoping lands. A Planner/Engineer session cannot write these tables directly today — non-owner writes (once built) must go through a server-side path that checks `can()` and uses the service-role client.
  - `created_by` on all three tables is trigger-stamped (`set_created_by`, `auth.uid()`) and excluded from client-facing grants, same pattern as `invites`/`users.is_platform_admin`.
  - **Live-tested lesson, fixed in `supabase/migrations/20260822193000_fix_clients_sites_assets_column_grants.sql`**: this project's `public` schema grants ALL table privileges to `authenticated`/`anon` by default on every newly created table. A column-restricted `grant insert (subset of columns)` / `grant update (subset of columns)` is purely additive and does **not** revoke the pre-existing unrestricted privilege on the other columns — you must `revoke all on <table> from authenticated;` first, then grant back exactly the intended columns (this is what `users`' `is_platform_admin` lockdown already did correctly in the baseline migration; the first cut of this migration omitted the revoke and was confirmed live to leak column-level INSERT/UPDATE on `created_by`/`organization_id`/`client_id` before the fix). Apply this `revoke all` step for every future tenant-scoped table that needs any column-level write restriction — don't assume a fresh table starts with zero grants for `authenticated`.
- **Tenant-configurable reference data (picklists)** — **implemented** in `supabase/migrations/20260822200000_reference_lists.sql`, tested in `supabase/tests/database/reference_lists_rls.test.sql`. Generalizes "Asset Type" / "Asset Status" (and every future tenant-configurable dropdown, e.g. Phase 2's Contract Type) into one reusable pattern instead of a hardcoded enum (can't gain a per-tenant value without a migration) or free text (no governance):
  - `reference_lists (id, organization_id, list_key, name, created_by, created_at, updated_at)` — one picklist container per `(organization_id, list_key)`, e.g. `list_key = 'asset_type'`. `list_key` is plain text (not an enum) specifically so a brand new picklist never needs a schema migration to introduce, only a data-seeding change.
  - `reference_list_items (id, reference_list_id, organization_id, value, label, color, sort_order, is_default, created_by, created_at, updated_at)` — the individual selectable values within a list (e.g. `value='hvac', label='HVAC'` inside the org's `asset_type` list). `value` is a stable machine slug (unique per list); `label` is the tenant-editable display text. At most one item per list has `is_default = true` (enforced by `enforce_single_default_reference_item` + a partial unique index) — used to auto-fill e.g. `assets.status_id` when a caller omits it on insert.
  - **Pattern choice, documented in the migration**: a generic reference-list pattern (one schema/RLS/seed-trigger surface shared by every picklist) was chosen over dedicated tables per concept (`asset_types`/`asset_statuses`) specifically because more of these are coming (Contract Type in Phase 2, likely SLA tier/priority later) and this codebase has already shipped the grant-lockdown boilerplate wrong twice on the first pass (see the two `fix_*_column_grants` migrations below) — minimizing how many times that boilerplate gets written is a real risk reduction. The trade-off: every query against a picklist's items is one join deeper than a dedicated table, and there's no per-concept FK typing (nothing at the schema level alone stops pointing `assets.type_id` at an `asset_status` item) — closed instead by the `validate_asset_reference_items` trigger on `assets`.
  - **`organization_id` denormalization**: `reference_list_items.organization_id` is denormalized from `reference_lists.organization_id` (via `reference_list_id`), kept in sync by the `derive_reference_list_item_org` trigger — same reasoning and shape as the `sites`/`assets` denormalization above, so RLS stays a single-column `is_member_of_org(organization_id)`/`is_org_owner(organization_id)` check with no in-policy joins. Unlike `sites.client_id`/`assets.site_id`, `reference_list_id` is NOT re-parentable — it's excluded from the UPDATE column grant entirely (moving "HVAC" from the `asset_type` list to the `asset_status` list is meaningless), so there's no cross-org re-parent guard to test on that column, only on INSERT.
  - **RLS**: SELECT is `is_member_of_org(organization_id)` (any role — every Select dropdown in the app needs this); INSERT/UPDATE/DELETE is `is_org_owner(organization_id)` only — same write boundary as `clients`/`sites`/`assets`.
  - **Seeded defaults on organization creation**: `seed_default_reference_lists(organization_id)` (idempotent, `on conflict do nothing` throughout) is called automatically by an `after insert on organizations` trigger (`organizations_seed_reference_lists`, SECURITY DEFINER — same pattern as `handle_new_auth_user`), so every new organization gets a starting `asset_type` list (HVAC, Electrical, Plumbing, Generator, Other — Other is the default) and `asset_status` list (Active [default], In Repair, Decommissioned) with zero application-layer effort. The one organization that already existed before this migration was backfilled once, directly in the migration, by the same idempotent function. **Any future tenant-configurable picklist (e.g. Phase 2 Contract Type) should extend `seed_default_reference_lists` with another `list_key` block plus a one-time backfill call in that feature's own migration — do not invent a new seeding mechanism.**
  - **What a client needs to query**: to populate a "select asset type" dropdown — `GET /reference_list_items?select=id,value,label,sort_order,is_default&reference_lists!inner(list_key)&reference_lists.list_key=eq.asset_type&order=sort_order` (RLS scopes it to the caller's own org automatically; no explicit `organization_id` filter needed, though the app may still want a stable server-side org context). To let an owner add a new value — first `GET /reference_lists?select=id&list_key=eq.asset_type` to get that org's list id, then `POST /reference_list_items` with `{ reference_list_id, value, label, sort_order? }` (as an `is_org_owner` session; `organization_id` is derived automatically and must not be supplied).
  - **Known gap, RESOLVED for the backend half**: `app/(app)/assets/schema.ts` (`assetCreateSchema`/`assetUpdateSchema`) and `app/(app)/assets/actions.ts` originally still targeted the OLD `type`/`status` columns (free text / `assetStatusSchema` enum) after this migration renamed those to `type_id`/`status_id` (uuid FKs) and dropped the old columns entirely. `api-backend-engineer` has since updated both files: `assetCreateSchema`/`assetUpdateSchema` now take `typeId`/`statusId` (uuid, `statusId` optional), and every `AssetRecord`-returning query in `actions.ts` selects `*, asset_type:reference_list_items!assets_type_id_fkey(value,label,color), asset_status:reference_list_items!assets_status_id_fkey(value,label,color)` (FK constraint names confirmed live — Postgres's default `<table>_<column>_fkey` naming for an unnamed column FK) so the frontend gets resolved type/status label+color in one round trip. `lib/actions/result.ts`'s `mapDbError` was also generalized so `23514` (wrong `list_key`/cross-org reference) and `23503` (dangling reference, in either direction — including the FK-restrict-on-delete case for an in-use `reference_list_items` row) both surface as clean messages. New `lib/reference-lists/{schema,actions}.ts` (owner-only CRUD, any-member read, gated on a new `settings` entry in `lib/rbac/permissions.ts` + `lib/rbac/features.ts`) manages `reference_lists`/`reference_list_items` directly, for reuse by any future picklist. **Still open, for `frontend-ui-engineer`**: the asset form UI (`app/(app)/assets/components/*`, `app/(app)/assets/[id]/page.tsx`) still reads the old `type`/`status` fields off `AssetRecord` and needs updating to `typeId`/`statusId` + the new `asset_type`/`asset_status` embeds, and there's no Settings page yet for managing picklist values.

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

### Relational detail pages — the standard, not a special case
A flat list + a create/edit modal is never the whole answer once a record has real relationships (a client has sites and assets; a contract will have line items and linked assets; a work order will have a client, a site, an asset, and a planner). Whenever you build or touch a detail page for an entity that has related child or parent records, apply this pattern:

- **Surface the relationship in place.** A parent detail page shows its related records as tabs (`Tabs` from `@yourorg/ui`), not just a link out to another module's list. Reference implementation: `app/(app)/clients/[id]/client-detail.tsx` — a client's own fields, plus `Sites` and `Assets` tabs on the same page, with `SitesPanel`'s per-site asset count jumping straight into the matching `Disclosure` group in `AssetsPanel`. That three-level hierarchy (client → sites → assets) staying visible and navigable from either tab, instead of being flattened into one generic table, is the bar — not the exception.
- **Create in context.** A record creatable from a parent's tab (e.g. adding an asset from a client's Assets tab) should open pre-scoped to that parent (client/site already set), not dump the user into a bare, disconnected form.
- **Nested groupings use `Disclosure`**, not a flat table, once a list has a natural sub-grouping (assets grouped by site, line items grouped by category, etc).
- **Breadcrumb the hierarchy**, don't just "back link" it. `BackLink` (single hop, "back to X") is right for a page with one obvious parent list. Once a page sits two or more levels deep in a real hierarchy (Clients → Acme Corp → Site X), it needs a breadcrumb trail showing the full path, not just a single hop backward — add a `Breadcrumbs` primitive to `@yourorg/ui` if one doesn't exist yet rather than approximating it with more `BackLink`s.
- **Known current gap**: `app/(app)/assets/[id]/page.tsx` (asset detail) does not meet this bar yet — it shows `Client`/`Site` as plain text/link `DetailRow`s with only a single `BackLink`, instead of the richer treatment `client-detail.tsx` gets. Bring it in line with the pattern above rather than treating it as acceptable prior art.

Before building a new module (Contracts, Planning, Reporting — see `docs/ROADMAP.md`), identify its real relationships first and design the detail page's tabs/breadcrumbs/nesting up front — don't ship the flat version now and "add relations later."

## Domain completeness

`docs/BUSINESS-PLAN.md` §4 was widened 2026-08-23 after review: the original module list only had each module's MVP slice (e.g. a client with one email/phone, no contact persons) instead of the realistic domain a premium comparable product has. This is now a standing requirement, not a one-time fix:

- **Before modeling a new module or entity**, briefly research 1-2 comparable premium SaaS products in that domain (ServiceTitan/Jobber/Housecall Pro/Salesforce Field Service-tier, or the closest equivalent for a non-FSM concern) and default to that realistic breadth of sub-entities/fields, not the minimum needed to satisfy the current user story. `docs/ROADMAP.md` names the modules already identified this way (Work Orders, Contacts, Quotes, Invoicing, Preventive Maintenance, Inventory, Customer Portal, etc.) — check there first before assuming something is out of scope.
- **Every categorical/type/status field is tenant-configurable** via `reference_lists`/`reference_list_items` (`supabase/migrations/20260822200000_reference_lists.sql`) — never a hardcoded enum or free text.
- **Check whether a reference list depends on another one** before modeling it as a flat list — e.g. Asset Sub-type's valid values depend on which Asset Type is selected. Use the dependent-list mechanism (`reference_lists.parent_list_key` + `reference_list_items.parent_item_id`, validated the same way `validate_asset_reference_items` validates cross-list correctness) instead of one flat list mixing every possible value, or instead of inventing a one-off parent/child table pair.
- **New sub-entities follow the "Relational detail pages" standard above**: surfaced as a `Tabs` entry on their parent, created in-context, not bolted on as a disconnected flat list reachable only via its own top-level route.

## Design system consumption
`@yourorg/ui` lives in this repo at `packages/ui`, as a real npm workspace package (root `package.json` `"workspaces": ["packages/*"]`), not a separate repo or private registry — there is no separate design-system repo, and none is planned for now. This is a deliberate choice, not a temporary stand-in (that was the old `vendor/yourorg-ui-stub`, now deleted): keeping it in-repo means the app and its design system iterate in the same PR.

- **Package structure**: TypeScript/TSX source in `packages/ui/src`, built with `tsup` to `packages/ui/dist` (both compiled JS — ESM + a CJS fallback for non-Next tooling — and generated `.d.ts` declarations straight from the `.tsx` source, so component implementations themselves are type-checked, not just call sites). `dist/` is gitignored, never committed — it's a build artifact, same as `.next/`.
- **The app still only ever imports from `@yourorg/ui`** / `@yourorg/ui/icons` / `@yourorg/ui/styles.css` (CLAUDE.md rule 4 is satisfied by this package boundary) — never reach into `packages/ui/src` or `dist` directly.
- **Build wiring**: `npm run build`/`npm run typecheck` at the root each have a `pre*` script (`prebuild`/`pretypecheck`) that builds `packages/ui` first, since the app consumes it like a normal dependency (needs `dist/` to exist), not via source transpilation. `npm run dev` has an equivalent `predev` step. CI (`.github/workflows/ci.yml`) builds `packages/ui` explicitly before lint/typecheck/build for the same reason.
- **Two "use client" boundaries**: `ThemeProvider`/`useTheme` and `Tabs` are the only stateful/interactive primitives in the package; everything else is a plain presentational function so it stays safe to render from Server Components. See the top-of-file comment in `packages/ui/tsup.config.ts` for why those two need their own dedicated build entries (a real, empirically-discovered esbuild/RSC directive-bundling gotcha, not incidental complexity).
- Fixes/changes to a component go into `packages/ui` directly, in the same PR as the app change that needed them — there's no "upstream repo" to send them to anymore.
