-- account_managers (issue #58, "Als gebruiker wil ik een kanban bord hebben
-- voor mijn klanten"). Prerequisite table for the next migration
-- (20260827100000_clients_kanban_status.sql), which adds
-- clients.account_manager_id pointing at this table.
--
-- Per the story: "Via instellingen wil ik dus gebruikers kunnen beheren
-- (mijn eigen login gebruikers van mij als client)... Die gebruikers zijn
-- nog vrij leeg, alleen Voornaam Achternaam" -- there is no existing
-- members/invite-management settings page in this app (checked the whole
-- app/(app)/settings tree), so this is NOT an extension of real org-member/
-- auth accounts (public.users/memberships). It is a deliberately minimal,
-- brand-new, org-scoped named-person list (first name + last name only)
-- whose only purpose today is to populate the "Account manager" picker on a
-- Client (clients.account_manager_id, added by the next migration).
--
-- Modeled exactly like public.asset_models
-- (20260826160000_asset_brand_and_models.sql): same organization-scoping,
-- same created_by/created_at/updated_at trigger shape, and the same
-- "select: any org member; insert/update/delete: owner only" RLS split,
-- since Account Managers are managed from Settings by the owner -- the same
-- permission boundary asset_models already uses for its own Settings-tab
-- manager.

create table public.account_managers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.account_managers is
  'A deliberately minimal, org-scoped named-person list (first name + last name only) used to populate the "Account manager" picker on a Client (clients.account_manager_id). NOT related to public.users/memberships (real login accounts) -- see the design note at the top of 20260827090000_account_managers.sql for why. Same RLS/grant shape as public.asset_models: any org member reads, owner configures.';
comment on column public.account_managers.organization_id is
  'Tenant scope. Supplied directly on insert, checked by RLS (is_org_owner), same as asset_models.organization_id / clients.organization_id.';

create index account_managers_organization_id_idx on public.account_managers (organization_id);
create index account_managers_created_by_idx on public.account_managers (created_by);

alter table public.account_managers enable row level security;
alter table public.account_managers force row level security;

create trigger account_managers_set_created_by
  before insert on public.account_managers
  for each row execute function public.set_created_by();

create trigger account_managers_set_updated_at
  before update on public.account_managers
  for each row execute function public.set_updated_at();

-- RLS: identical shape to asset_models/reference_lists/checklist_templates
-- -- select: any org member; write: owner only.
create policy "account_managers_select_member"
on public.account_managers
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "account_managers_insert_owner"
on public.account_managers
for insert
to authenticated
with check (public.is_org_owner(organization_id));

create policy "account_managers_update_owner"
on public.account_managers
for update
to authenticated
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

create policy "account_managers_delete_owner"
on public.account_managers
for delete
to authenticated
using (public.is_org_owner(organization_id));

-- New table: this project's public schema grants ALL privileges to
-- authenticated/anon by default on every newly created table -- always
-- revoke first (see 20260822193000_fix_clients_sites_assets_column_grants.sql).
revoke all on public.account_managers from authenticated;

grant select, delete on public.account_managers to authenticated;
-- organization_id is insertable (like asset_models.organization_id /
-- reference_lists.organization_id) but not updatable -- no legitimate "move
-- this account manager to a different organization" action. created_by
-- intentionally excluded from both: trigger-stamped by set_created_by.
grant insert (
  organization_id, first_name, last_name
) on public.account_managers to authenticated;
grant update (
  first_name, last_name
) on public.account_managers to authenticated;
