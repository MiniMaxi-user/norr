-- Activities: add contract_id (issue #127), mirroring work_orders.contract_id
-- EXACTLY (20260823150000_contracts_core.sql, "work_orders.contract_id:
-- deferred from 20260823120000_work_orders_core.sql" section) — the
-- established precedent for "an operational record can optionally be tied to
-- one specific contract, scoped to its own client".
--
-- Design notes:
--
-- 1. Plain additive column + index on an existing, already-locked-down
--    table — ALTER TABLE ADD COLUMN does not re-trigger the "grant ALL to
--    authenticated by default on new tables" gotcha (same non-issue as
--    work_orders.contract_id/source_quote_id/source_activity_id before it).
--    No RLS policy change: activities' existing SELECT/INSERT/UPDATE/DELETE
--    policies are untouched, only new column-level grants are added.
--
-- 2. The cross-field check joins the EXISTING validate_activity_relations
--    trigger (CREATE OR REPLACE, widened column list) rather than becoming a
--    parallel trigger — same "widen the existing trigger's column list"
--    approach work_orders.contract_id used on validate_work_order_relations,
--    and the same approach this table's own source_quote_id-style additions
--    would use if/when they land.
--
-- 3. Nullable-client_id edge case (does NOT apply here): unlike the task's
--    generic caution, activities.client_id is `not null` (see
--    20260828090000_activities_core.sql) — every activity, without
--    exception, has a client. So there is no "contract_id set but no
--    client_id to cross-check against" case to design around: the check is
--    IDENTICAL in shape to work_orders.contract_id's own (contract must
--    exist, and its client_id must equal the row's own client_id), with no
--    conditional skip needed.
alter table public.activities
  add column contract_id uuid references public.contracts (id) on delete set null;

comment on column public.activities.contract_id is
  'Nullable FK into contracts — the contract this activity ("melding") is being handled under, if any. When set, must belong to the same client_id as the activity (validated by validate_activity_relations, same cross-field spirit as the existing asset_id/contact_person_id checks). activities.client_id is not null, exactly like work_orders.client_id, so this check never has to special-case a missing client_id. Added by 20260907090000_activities_contract_id.sql (issue #127), mirroring work_orders.contract_id (20260823150000_contracts_core.sql).';

create index activities_contract_id_idx on public.activities (contract_id);

-- Extend (CREATE OR REPLACE, not a parallel trigger) validate_activity_relations
-- with the contract_id <-> client_id cross-field check, and widen the
-- trigger's column list to include contract_id.
create or replace function public.validate_activity_relations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset_client_id uuid;
  v_contact_client_id uuid;
  v_action_holder_is_member boolean;
  v_type_value text;
  v_contract_client_id uuid;
begin
  if new.asset_id is not null then
    select a.client_id into v_asset_client_id
    from public.assets a
    where a.id = new.asset_id;

    if v_asset_client_id is null then
      raise exception 'activities.asset_id % does not reference an existing asset', new.asset_id
        using errcode = '23503';
    elsif v_asset_client_id <> new.client_id then
      raise exception 'activities.asset_id must belong to the same client as the activity'
        using errcode = '23514';
    end if;
  end if;

  if new.contact_person_id is not null then
    select ct.client_id into v_contact_client_id
    from public.contacts ct
    where ct.id = new.contact_person_id;

    if v_contact_client_id is null then
      raise exception 'activities.contact_person_id % does not reference an existing contact', new.contact_person_id
        using errcode = '23503';
    elsif v_contact_client_id <> new.client_id then
      raise exception 'activities.contact_person_id must belong to the same client as the activity'
        using errcode = '23514';
    end if;
  end if;

  if new.action_holder_id is not null then
    select exists (
      select 1
      from public.memberships m
      where m.user_id = new.action_holder_id
        and m.organization_id = new.organization_id
    ) into v_action_holder_is_member;

    if not v_action_holder_is_member then
      raise exception 'activities.action_holder_id must be a member of the same organization as the activity'
        using errcode = '23514';
    end if;
  end if;

  select rli.value into v_type_value
  from public.reference_list_items rli
  where rli.id = new.type_id;

  if v_type_value in ('storing', 'onderhoud') and new.asset_id is null then
    raise exception 'activities.asset_id is required when the activity type is Storing or Onderhoud (type value=%)', v_type_value
      using errcode = '23514';
  end if;

  if v_type_value = 'bel_activiteit'
     and new.contact_person_id is null
     and (new.contact_name is null or new.contact_phone is null) then
    raise exception 'activities.contact_person_id, or both contact_name and contact_phone, is required when the activity type is Bel activiteit'
      using errcode = '23514';
  end if;

  if new.contract_id is not null then
    select c.client_id into v_contract_client_id
    from public.contracts c
    where c.id = new.contract_id;

    if v_contract_client_id is null then
      raise exception 'activities.contract_id % does not reference an existing contract', new.contract_id
        using errcode = '23503';
    elsif v_contract_client_id <> new.client_id then
      raise exception 'activities.contract_id must belong to the same client as the activity'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_activity_relations() is
  'BEFORE INSERT/UPDATE OF client_id, asset_id, contact_person_id, contact_name, contact_phone, action_holder_id, type_id, contract_id trigger on public.activities: rejects an asset_id/contact_person_id/contract_id from a different client than the activity''s own client_id, an action_holder_id who is not a member of the activity''s own organization, a missing asset_id when type=storing/onderhoud, and missing contact info when type=bel_activiteit. Resolves the type''s identity by its stable seeded value (not label text). Extended in 20260907090000_activities_contract_id.sql with the contract_id check (issue #127), same shape as validate_work_order_relations'' own contract_id check. Runs after activities_derive_organization_id (alphabetically later trigger name, same timing), so new.organization_id is already final.';

drop trigger if exists activities_validate_relations on public.activities;

create trigger activities_validate_relations
  before insert or update of client_id, asset_id, contact_person_id, contact_name, contact_phone, action_holder_id, type_id, contract_id on public.activities
  for each row execute function public.validate_activity_relations();

grant insert (contract_id) on public.activities to authenticated;
grant update (contract_id) on public.activities to authenticated;
