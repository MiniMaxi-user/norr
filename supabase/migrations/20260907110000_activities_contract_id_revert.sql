-- Revert 20260907090000_activities_contract_id.sql (issue #127) in full,
-- same day, per product-owner feedback (issue #128): a stored
-- activities.contract_id is redundant — the contract should be derived
-- from the linked Asset/Client instead, not stored as its own column.
--
-- This undoes all four things the reverted migration did:
--
-- 1. Reverts validate_activity_relations() back to its PRE-#127 shape
--    (removes the contract_id <-> client_id cross-field check entirely,
--    not left in as dead code against a column that no longer exists).
--    This is a straight copy of the function body from
--    20260828090000_activities_core.sql, the only other migration that
--    has ever defined it.
-- 2. Reverts the activities_validate_relations trigger's own
--    `before insert or update of ...` column list back to its original
--    set (drops contract_id from it). This must happen BEFORE the column
--    drop below — the trigger's own column list references contract_id,
--    so Postgres refuses to drop the column while a trigger still
--    depends on it (2BP01).
-- 3. Drops activities.contract_id itself, now that nothing depends on it.
--    Postgres cascades the drop to the column's own index
--    (activities_contract_id_idx) and column-level grants automatically —
--    no separate `drop index`/`revoke` needed.
-- 4. The column-level `grant insert (contract_id)`/`grant update
--    (contract_id)` from the reverted migration are dropped implicitly
--    by step 3 (grants on a column do not survive that column's drop).

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

  return new;
end;
$$;

comment on function public.validate_activity_relations() is
  'BEFORE INSERT/UPDATE OF client_id, asset_id, contact_person_id, contact_name, contact_phone, action_holder_id, type_id trigger on public.activities: rejects an asset_id/contact_person_id from a different client than the activity''s own client_id, an action_holder_id who is not a member of the activity''s own organization, a missing asset_id when type=storing/onderhoud, and missing contact info when type=bel_activiteit. Resolves the type''s identity by its stable seeded value (not label text). Runs after activities_derive_organization_id (alphabetically later trigger name, same timing), so new.organization_id is already final. The contract_id check added by 20260907090000_activities_contract_id.sql (issue #127) was reverted the same day by 20260907110000_activities_contract_id_revert.sql (issue #128) — the contract is derived from the linked Asset/Client, not stored.';

drop trigger if exists activities_validate_relations on public.activities;

create trigger activities_validate_relations
  before insert or update of client_id, asset_id, contact_person_id, contact_name, contact_phone, action_holder_id, type_id on public.activities
  for each row execute function public.validate_activity_relations();

alter table public.activities
  drop column contract_id;
