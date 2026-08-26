-- Tenant activate/deactivate: `organizations.is_active` (issue #47, "Als
-- platform admin wil ik duidelijk zien welke client geactiveerd is voor
-- tenant"). Schema/RLS layer only -- the deactivate/reactivate Server
-- Action and the login-time gate are separate follow-up passes
-- (`auth-rbac-engineer`) on top of what this migration provides; the
-- "deactivate as tenant" button UI is a `frontend-ui-engineer` follow-up.
--
-- ---------------------------------------------------------------------------
-- 1. New column
-- ---------------------------------------------------------------------------
-- `not null default true`: every existing organization (the Platform org
-- itself, and every already-`activateAsTenant`'d tenant org) stays active --
-- the default backfills every existing row with zero explicit UPDATE
-- needed. `activateAsTenant` (`app/(app)/clients/actions.ts`, issue #45)
-- only ever creates a brand-new `organizations` row, so this default is also
-- exactly the value that path already implicitly wants going forward.
alter table public.organizations
  add column is_active boolean not null default true;

comment on column public.organizations.is_active is
  'Whether this tenant is currently active (issue #47). false = the
Platform Admin has deactivated this organization as a tenant: every
tenant-scoped table''s RLS becomes unreadable/unwritable to that org''s own
members via is_member_of_org()/is_org_owner() below (defense-in-depth data
isolation), and the org''s users should be blocked from logging in at the
application layer (auth-rbac-engineer, not enforced here). Reactivating
(true) restores exactly the prior access -- this column is the only state
that changes; membership rows are never touched by activate/deactivate.';

-- ---------------------------------------------------------------------------
-- 2. Extend `is_member_of_org` / `is_org_owner` to also require the target
--    organization to be active.
--
-- This is the single choke point mentioned in this repo's baseline RLS
-- migration ("every future tenant-scoped table should call
-- is_member_of_org(organization_id) from its policies rather than
-- re-deriving membership inline") -- essentially every tenant-scoped table
-- added since (clients, sites, assets, contacts, reference_lists,
-- work_orders, contracts, time_entries, checklists, quotes, invites,
-- memberships itself) calls one of these two functions in its RLS policy.
-- Adding `and o.is_active` here, once, makes an entire deactivated tenant's
-- data invisible/unwritable under RLS to that org's own members with zero
-- per-table migrations -- this is what satisfies acceptance criterion 3
-- ("once no longer a tenant, that org's access/modules are no longer
-- visible") as defense-in-depth (not just an app-layer visibility check),
-- and materially contributes to criterion 4 (even if a still-technically-
-- valid session/JWT exists, RLS blocks every read/write). Signatures
-- (`org_id uuid) returns boolean`) are unchanged, so no caller/policy
-- anywhere needs to change.
--
-- Reactivating (`is_active = true`) restores exactly the prior
-- `is_member_of_org`/`is_org_owner` answer with no other state change,
-- since the join adds a pure filter and nothing else.
create or replace function public.is_member_of_org(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and o.is_active
  );
$$;

create or replace function public.is_org_owner(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.role = 'owner'
      and o.is_active
  );
$$;

-- `org_has_members` is deliberately left unchanged: it only gates the
-- one-time self-bootstrap owner insert into a brand-new organization (which
-- is always `is_active = true` by construction -- nothing creates an
-- organization pre-deactivated), so active/inactive is not a meaningful
-- distinction for it.

-- ---------------------------------------------------------------------------
-- 3. `organizations_select_creator_or_member`'s `created_by = auth.uid()`
--    branch (`20260822150910_organizations_memberships_baseline_rls.sql`) --
--    confirmed correct as-is, NOT changed here.
--
-- That branch is a plain column comparison against the `organizations` row
-- itself; it does not call `is_member_of_org`/`is_org_owner` and is
-- therefore wholly unaffected by the change above. This is required, not
-- incidental: the Platform Admin is the one who calls `activateAsTenant`
-- (`created_by = auth.uid()` on the resulting `organizations` row, since the
-- Platform Admin's own session creates it), and must still be able to
-- SELECT/manage that org row -- e.g. to flip `is_active` back to true --
-- while it is deactivated. If this branch also required `is_active`, a
-- deactivated tenant's own org row would disappear even from the one person
-- (the Platform Admin) who needs to see it in order to reactivate it,
-- which would make deactivation irreversible through RLS. Left as-is.
--
-- ---------------------------------------------------------------------------
-- 4. `memberships_select_self_or_same_org`
--    (`20260822173916_fix_memberships_self_visibility.sql`) -- one more
--    branch found during due diligence (grep for `is_member_of_org`/
--    `is_org_owner` across supabase/migrations, see below) that does NOT
--    route through either helper function and so would otherwise remain a
--    residual gap: `user_id = auth.uid()` lets a member see their OWN
--    membership row directly, bypassing `is_member_of_org` entirely. Left
--    unchanged, that branch would let a deactivated org's member still read
--    their own `(organization_id, role)` membership row via RLS even while
--    fully locked out of every other tenant-scoped table -- inconsistent
--    with criterion 3's intent. Closed here by requiring the same
--    organization to be active for that branch too, checked directly
--    against `organizations` (not `memberships`) so this does NOT
--    reintroduce the same-command MVCC self-visibility bug that
--    `20260822173916` fixed (that bug was specifically about a
--    SECURITY DEFINER function re-querying `memberships` from within a
--    `memberships` policy; querying `organizations` has no such issue).
-- For any already-active organization (the overwhelming common case,
-- including every org that existed before this migration), this is a
-- no-op: the `org-peer` branch (`is_member_of_org`) already covers the
-- exact same rows.
drop policy "memberships_select_self_or_same_org" on public.memberships;

create policy "memberships_select_self_or_same_org"
on public.memberships
for select
to authenticated
using (
  (
    user_id = auth.uid()
    and exists (
      select 1
      from public.organizations o
      where o.id = memberships.organization_id
        and o.is_active
    )
  )
  or public.is_member_of_org(organization_id)
);

-- ---------------------------------------------------------------------------
-- Due diligence performed before writing this migration (grep across
-- supabase/migrations/ and app/):
--   - `is_member_of_org`/`is_org_owner` are referenced by every
--     tenant-scoped table's migration to date (clients/sites/assets,
--     invites, reference_lists, contacts, work_orders, contracts,
--     time_entries, checklists, quotes, plus this baseline file) --
--     confirming the "single choke point" premise this migration relies on.
--   - No existing migration, policy, index, or application code (`app/`)
--     references `is_active` or an `is_active`-shaped column/flag anywhere
--     -- this is a wholly new column/behavior.
--   - `memberships_select_self_or_same_org` was the only RLS policy found,
--     besides `organizations_select_creator_or_member`'s already-discussed
--     `created_by` branch, that reads a tenant-scoped table without going
--     through `is_member_of_org`/`is_org_owner`; addressed in section 4
--     above.
--   - `activateAsTenant` (`app/(app)/clients/actions.ts`) always creates a
--     brand-new `organizations` row and links it via
--     `clients.represents_organization_id`; it never targets an arbitrary
--     existing org, and the Platform Admin's own "Platform" org has no
--     `represents_organization_id` pointing at itself -- so the Platform
--     org is structurally unreachable via any future deactivate action
--     built on this column and needs no special-case protection here.
--   - docs/ARCHITECTURE.md updated in the same change (see the
--     `organizations` bullet and the `is_member_of_org`/`is_org_owner`
--     helper description under "Multi-tenancy & data isolation").
