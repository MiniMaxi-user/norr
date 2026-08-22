-- Organizations, memberships, and user-profile foundation + baseline RLS.
-- See docs/ARCHITECTURE.md ("Multi-tenancy & data isolation" / "Core schema (v1)").
--
-- Design notes (read before extending):
--
-- 1. Self-referencing RLS policies on `memberships` (and cross-table checks
--    that need to read `memberships`) are implemented via SECURITY DEFINER
--    helper functions (`is_member_of_org`, `is_org_owner`, `org_has_members`)
--    owned by the migration role (which bypasses RLS). Querying `memberships`
--    directly from within a policy defined *on* `memberships` causes
--    "infinite recursion detected in policy" in Postgres — the helper
--    functions are the standard, documented workaround. Every future
--    tenant-scoped table should call `is_member_of_org(organization_id)`
--    from its policies rather than re-deriving membership inline.
--
-- 2. Bootstrapping: a brand-new user must be able to create their first
--    organization and become its owner without any pre-existing membership
--    to authorize it (classic RLS chicken-and-egg problem). This migration
--    solves it with two rules:
--      a. `organizations` SELECT policy allows the row's creator
--         (`created_by = auth.uid()`) to see it even before any membership
--         exists (also needed so `INSERT ... RETURNING` actually returns the
--         new row to the client).
--      b. `memberships` INSERT policy allows a user to insert themselves as
--         `owner` for an organization they created, but ONLY while that
--         organization still has zero members (`org_has_members` = false).
--         Once that first owner membership exists, all further membership
--         inserts require the caller to already be an `owner` of the target
--         org (this is what the future invite flow, issue #3/#4, will use).
--
-- 3. `users.is_platform_admin` is intentionally NOT reachable from any
--    client-facing INSERT/UPDATE path: profile rows are created only by a
--    SECURITY DEFINER trigger on `auth.users`, and the `authenticated` role
--    is only granted column-level UPDATE on `full_name` (never on
--    `is_platform_admin`, `email`, or `id`). Platform-admin cross-tenant
--    reads happen exclusively through the service-role client
--    (`lib/supabase/admin.ts`), audited in application code, per
--    docs/ARCHITECTURE.md — there is deliberately no RLS bypass policy for
--    `is_platform_admin` users here.

-- ---------------------------------------------------------------------------
-- Reusable trigger: keep `updated_at` current on row updates.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- users: profile table extending auth.users (1:1)
-- ---------------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.users is
  'Profile row extending auth.users. is_platform_admin is platform-level and separate from any tenant role in memberships; never assignable via tenant-facing invite flows.';
comment on column public.users.is_platform_admin is
  'Platform Admin flag. Set only via trusted server-side/service-role operations, never via client-facing insert/update.';

create index users_email_idx on public.users (email);

alter table public.users enable row level security;
alter table public.users force row level security;

-- Populate public.users automatically whenever a new auth.users row is
-- created (signup). Runs as the function owner (bypasses RLS), so no
-- client-facing INSERT policy on public.users is needed or granted.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- organizations: tenants
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organizations is 'Tenants. One row per customer organization of the SaaS.';

create index organizations_created_by_idx on public.organizations (created_by);

alter table public.organizations enable row level security;
alter table public.organizations force row level security;

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- memberships: user <-> organization, with tenant role
-- ---------------------------------------------------------------------------
create type public.membership_role as enum (
  'owner',
  'planner',
  'engineer',
  'finance',
  'administratie'
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  role public.membership_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, organization_id)
);

comment on table public.memberships is
  'Tenant role assignment for a user within one organization. Role is per-membership, distinct from users.is_platform_admin.';

create index memberships_organization_id_idx on public.memberships (organization_id);
create index memberships_user_id_idx on public.memberships (user_id);

alter table public.memberships enable row level security;
alter table public.memberships force row level security;

create trigger memberships_set_updated_at
  before update on public.memberships
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Helper functions for RLS (SECURITY DEFINER to safely bypass RLS on
-- `memberships` from within policies, avoiding self-referencing recursion).
-- Every tenant-scoped table added later should reuse `is_member_of_org`.
-- ---------------------------------------------------------------------------
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
    where m.organization_id = org_id
      and m.user_id = auth.uid()
  );
$$;

comment on function public.is_member_of_org(uuid) is
  'True if the current auth.uid() has any membership (any role) in the given organization. Use this in RLS policies of tenant-scoped tables instead of inlining a memberships subquery.';

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
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.role = 'owner'
  );
$$;

comment on function public.is_org_owner(uuid) is
  'True if the current auth.uid() holds the owner role in the given organization.';

create or replace function public.org_has_members(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organization_id = org_id
  );
$$;

comment on function public.org_has_members(uuid) is
  'True if the given organization already has at least one membership row. Used to gate the one-time self-bootstrap owner insert.';

revoke all on function public.is_member_of_org(uuid) from public;
revoke all on function public.is_org_owner(uuid) from public;
revoke all on function public.org_has_members(uuid) from public;
grant execute on function public.is_member_of_org(uuid) to authenticated;
grant execute on function public.is_org_owner(uuid) to authenticated;
grant execute on function public.org_has_members(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS policies: users
-- ---------------------------------------------------------------------------

-- Visible: your own profile, or the profile of anyone who shares at least
-- one organization membership with you (member-list / assignment UIs).
create policy "users_select_self_or_org_peers"
on public.users
for select
to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = auth.uid()
      and theirs.user_id = users.id
  )
);

-- No INSERT policy for `users`: rows are created solely by the
-- `handle_new_auth_user` trigger (SECURITY DEFINER, bypasses RLS).

create policy "users_update_self"
on public.users
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Column-level lockdown: even though the row-level policy above allows a
-- user to update their own row, restrict *which columns* the authenticated
-- role may write so `is_platform_admin` / `email` / `id` cannot be
-- self-elevated or spoofed.
revoke update on public.users from authenticated;
grant update (full_name) on public.users to authenticated;

grant select on public.users to authenticated;
-- No delete grant/policy: profile rows are removed only via the
-- `on delete cascade` from auth.users.

-- ---------------------------------------------------------------------------
-- RLS policies: organizations
-- ---------------------------------------------------------------------------

-- Visible: rows you created (even before any membership exists — needed for
-- INSERT ... RETURNING during bootstrap) or rows for orgs you're a member of.
create policy "organizations_select_creator_or_member"
on public.organizations
for select
to authenticated
using (
  created_by = auth.uid()
  or public.is_member_of_org(id)
);

-- Any authenticated user may create an organization (this is how a brand
-- new tenant/signup starts); it grants no access on its own until the
-- caller also inserts their own owner membership (see memberships policy
-- below).
create policy "organizations_insert_authenticated"
on public.organizations
for insert
to authenticated
with check (created_by = auth.uid());

create policy "organizations_update_owner"
on public.organizations
for update
to authenticated
using (public.is_org_owner(id))
with check (public.is_org_owner(id));

-- No DELETE policy: tenant deletion is a platform-level operation performed
-- via the service-role client, not exposed to tenant users through RLS.

grant select, insert, update on public.organizations to authenticated;

-- ---------------------------------------------------------------------------
-- RLS policies: memberships
-- ---------------------------------------------------------------------------

create policy "memberships_select_same_org"
on public.memberships
for select
to authenticated
using (public.is_member_of_org(organization_id));

-- Insert is allowed in exactly two cases:
--   1. Bootstrap: you created the organization, you're inserting yourself,
--      as owner, and the organization has no members yet.
--   2. Ongoing: you're already an owner of the target organization (this is
--      the case the future invite flow relies on).
create policy "memberships_insert_bootstrap_or_owner"
on public.memberships
for insert
to authenticated
with check (
  (
    user_id = auth.uid()
    and role = 'owner'
    and not public.org_has_members(organization_id)
    and exists (
      select 1
      from public.organizations o
      where o.id = memberships.organization_id
        and o.created_by = auth.uid()
    )
  )
  or public.is_org_owner(organization_id)
);

create policy "memberships_update_owner"
on public.memberships
for update
to authenticated
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

-- Delete is allowed if you're removing your own membership (leaving an org)
-- or you're an owner of the org (revoking someone else's access).
create policy "memberships_delete_self_or_owner"
on public.memberships
for delete
to authenticated
using (
  user_id = auth.uid()
  or public.is_org_owner(organization_id)
);

grant select, insert, update, delete on public.memberships to authenticated;
