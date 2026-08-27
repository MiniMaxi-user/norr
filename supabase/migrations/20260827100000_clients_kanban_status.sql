-- Real Kanban board for Clients (issue #58, "Als gebruiker wil ik een
-- kanban bord hebben voor mijn klanten"), replacing the current primitive
-- stacked-cards kanban (app/(app)/clients/kanban.ts's
-- groupClientsForKanban, which explicitly says in its own doc comment: "the
-- moment a real clients.stage column exists, swap this function's body for
-- a .reduce over that instead"). Depends on
-- 20260827090000_account_managers.sql (account_manager_id FK).
--
-- Five new columns on public.clients:
--
-- 1. `status text not null default 'lead' check (status in ('lead',
--    'qualified','proposal','won'))` -- the kanban's 4 fixed columns
--    (Lead / Qualified / Proposal / Won). A plain CHECK-constrained text
--    column, deliberately NOT a reference_list_items FK: unlike Asset
--    Type/Status etc., these 4 stages are fixed by the story itself
--    ("Statussen voor nu zijn de 4 kolommen"), not tenant-configurable
--    data. Every existing client is backfilled to 'lead' via the `not null
--    default` add-column (no separate UPDATE needed).
--
-- 2. `account_manager_id uuid null references account_managers(id) on
--    delete set null` -- the client's default Account Manager, shown on
--    its kanban card. Validated (same organization as the client, not just
--    "exists somewhere") by validate_client_account_manager, same
--    structural style as validate_site_contact_persons /
--    validate_asset_model_reference_items.
--
-- 3. `potential_value numeric(12,2) null check (potential_value is null or
--    potential_value >= 0)` -- a potential deal amount (explicitly NOT
--    "ARR" -- product owner's own words: "niet ARR, maar gewoon een
--    potentieel bedrag"). Negative disallowed (no domain meaning for a
--    negative "potential"); no other format validation.
--
-- 4. `client_since date null` -- the app defaults this to today only on
--    CREATE, never auto-fills on edit; that's pure UI-layer logic, so no
--    DB default here.
--
-- 5. `won_at timestamptz null` -- NOT directly writable by the app (see
--    grants below); maintained entirely by set_client_won_at. Purpose: the
--    kanban's "Won" column only shows clients that became Won in the last
--    4 weeks (product owner: "Laatste kolom won toon je alleen de klanten
--    die de laatste 4 weken Won zijn geworden. Daarna verdwijnen ze") --
--    this timestamp is what that 4-week window is computed from
--    (application-layer filtering in the list query/grouping, not RLS).
--
-- Trigger `set_client_won_at` (BEFORE INSERT OR UPDATE OF status): whenever
-- a row's status BECOMES 'won' from something that wasn't 'won' (INSERT
-- with status='won', or UPDATE where old status was distinct from 'won'),
-- sets won_at = now(). Whenever status changes AWAY from 'won' to
-- something else, clears won_at = null (so dragging a card out of Won and
-- back in later restarts the 4-week clock -- "became Won" semantics, not
-- "was ever Won once"). If status is updated but stays 'won'->'won', or
-- changes between two non-'won' values, won_at is left untouched.
--
-- RLS: no new/changed policy needed. Writing these columns is already
-- covered by the existing clients_insert_owner/clients_update_owner
-- policies (is_org_owner(organization_id)) from
-- 20260822190000_clients_sites_assets.sql -- same reasoning as
-- 20260825160000_clients_represents_organization.sql's "no new policy
-- needed" note. Only the column-level INSERT/UPDATE grants need extending.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.clients
  add column status text not null default 'lead'
    constraint clients_status_check check (status in ('lead', 'qualified', 'proposal', 'won')),
  add column account_manager_id uuid references public.account_managers (id) on delete set null,
  add column potential_value numeric(12,2)
    constraint clients_potential_value_non_negative check (potential_value is null or potential_value >= 0),
  add column client_since date,
  add column won_at timestamptz;

comment on column public.clients.status is
  'The kanban''s 4 fixed columns (issue #58): lead | qualified | proposal | won. Plain CHECK-constrained text, not a reference_list_items FK -- these 4 stages are fixed by the story itself, not tenant-configurable. Existing rows backfilled to ''lead'' via this column''s own default.';
comment on column public.clients.account_manager_id is
  'The client''s default Account Manager (issue #58), shown on its kanban card. Nullable, on delete set null. FK into account_managers (20260827090000_account_managers.sql); validated by validate_client_account_manager to belong to the SAME organization as the client.';
comment on column public.clients.potential_value is
  'A potential deal amount (issue #58) -- explicitly NOT "ARR" (product owner: "niet ARR, maar gewoon een potentieel bedrag"). Nullable, optional. check (potential_value is null or potential_value >= 0): a negative potential has no domain meaning.';
comment on column public.clients.client_since is
  'Nullable date. The app defaults this to today only on CREATE, never auto-fills on edit -- pure UI-layer/application logic (lib/... server action), deliberately no DB default here.';
comment on column public.clients.won_at is
  'Timestamp of when this client MOST RECENTLY became status=''won'' (issue #58). NOT directly writable by the app (excluded from both the INSERT and UPDATE column grants below) -- maintained entirely by the set_client_won_at trigger. Drives the kanban''s "Won" column 4-week visibility window (application-layer filtering, not RLS) -- "became Won" semantics: leaving and re-entering Won restarts the clock.';

create index clients_organization_id_status_idx on public.clients (organization_id, status);
create index clients_account_manager_id_idx on public.clients (account_manager_id);
-- Partial: only rows that have ever been won carry a non-null won_at: this
-- index directly serves the kanban's own "Won column, last 4 weeks" query
-- (status = 'won' order by/filter on won_at).
create index clients_won_at_idx on public.clients (won_at) where won_at is not null;

-- ---------------------------------------------------------------------------
-- 2. validate_client_account_manager: account_manager_id, when set, must
--    belong to the SAME organization as the client (same structural style
--    as validate_site_contact_persons / validate_asset_model_reference_items).
-- ---------------------------------------------------------------------------
create or replace function public.validate_client_account_manager()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_am_org uuid;
begin
  if new.account_manager_id is not null then
    select organization_id into v_am_org
    from public.account_managers
    where id = new.account_manager_id;

    if v_am_org is null then
      raise exception 'clients.account_manager_id % does not reference an existing account_manager', new.account_manager_id
        using errcode = '23503';
    elsif v_am_org <> new.organization_id then
      raise exception 'clients.account_manager_id must belong to the same organization as the client'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_client_account_manager() is
  'BEFORE INSERT/UPDATE OF account_manager_id trigger on public.clients: rejects an account_manager_id belonging to a different organization than the client itself. SECURITY DEFINER so it can resolve the referenced account_managers row regardless of the caller''s own RLS visibility into it, same reasoning as validate_site_contact_persons/validate_asset_model_reference_items.';

create trigger clients_validate_account_manager
  before insert or update of account_manager_id on public.clients
  for each row execute function public.validate_client_account_manager();

-- ---------------------------------------------------------------------------
-- 3. set_client_won_at: maintains won_at from status transitions. See
--    migration header for the exact "became Won" semantics.
-- ---------------------------------------------------------------------------
create or replace function public.set_client_won_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'won' and (tg_op = 'INSERT' or old.status is distinct from 'won') then
    new.won_at := now();
  elsif new.status <> 'won' and tg_op = 'UPDATE' and old.status = 'won' then
    new.won_at := null;
  end if;

  return new;
end;
$$;

comment on function public.set_client_won_at() is
  'BEFORE INSERT/UPDATE OF status trigger on public.clients: sets won_at = now() the moment status BECOMES ''won'' (INSERT with status=''won'', or UPDATE where the old status was not ''won''); clears won_at back to null the moment status changes AWAY from ''won''. Staying ''won''->''won'' (some other column changing) or moving between two non-''won'' statuses leaves won_at untouched. "Became Won" semantics, not "was ever Won once" -- dragging a kanban card out of Won and back in later restarts the 4-week visibility clock (issue #58). won_at is deliberately excluded from clients'' client-facing INSERT/UPDATE column grants -- this trigger is its only writer.';

create trigger clients_set_won_at
  before insert or update of status on public.clients
  for each row execute function public.set_client_won_at();

-- ---------------------------------------------------------------------------
-- 4. Column-level grants: additive only (clients' revoke-all lockdown
--    already happened in 20260822193000_fix_clients_sites_assets_column_grants.sql,
--    same "plain additive grant" pattern used by
--    20260825150000_clients_business_fields.sql /
--    20260825160000_clients_represents_organization.sql for prior clients
--    column additions). won_at intentionally excluded from both --
--    trigger-only, never client-writable, same lockdown pattern as
--    created_by/organization_id elsewhere in this schema.
-- ---------------------------------------------------------------------------
grant insert (
  status, account_manager_id, potential_value, client_since
) on public.clients to authenticated;
grant update (
  status, account_manager_id, potential_value, client_since
) on public.clients to authenticated;
