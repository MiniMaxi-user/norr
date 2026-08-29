-- Work Orders: add work_orders.source_activity_id (issue #87, "Workorder
-- uitbreiding") — traceability from a Work Order created via the "Maak
-- werkbon" button on an Activity ("melding") record. Follows the EXACT
-- precedent of work_orders.source_quote_id / contracts.source_quote_id
-- (supabase/migrations/20260824090000_quotes_core.sql): a plain nullable,
-- additive FK column on an already-existing, already-locked-down table (no
-- `revoke all` needed — ALTER TABLE ADD COLUMN doesn't inherit the
-- "revoke all on new tables" gotcha), extending validate_work_order_relations
-- (CREATE OR REPLACE, not a parallel trigger) with the matching cross-field
-- check. This closes the "No FK from/to work_orders exists yet" gap flagged
-- in docs/SCHEMA-HISTORY.md's "Activities" section
-- (20260828090000_activities_core.sql). No backfill: new nullable column, no
-- existing data to migrate.
-- ---------------------------------------------------------------------------

alter table public.work_orders
  add column source_activity_id uuid references public.activities (id) on delete set null;

comment on column public.work_orders.source_activity_id is
  'Nullable FK into activities — the melding this work order was created from, if any. When set, must belong to the same client_id as the work order (validated by validate_work_order_relations, same cross-field spirit as the existing site_id/asset_id/contract_id/source_quote_id checks). The actual activity-to-work-order conversion logic (e.g. the "Maak werkbon" button on an Activity record, issue #87) is application-layer, out of scope here.';

create index work_orders_source_activity_id_idx on public.work_orders (source_activity_id);

-- Extend (CREATE OR REPLACE, not a parallel trigger) validate_work_order_relations
-- with the source_activity_id <-> client_id cross-field check, and widen the
-- trigger's column list to include source_activity_id. Full body copied
-- forward from 20260824090000_quotes_core.sql (last migration to extend this
-- function) with only the new check and declaration added — every existing
-- check (site_id, asset_id, assigned_to, contract_id, source_quote_id) is
-- preserved verbatim.
create or replace function public.validate_work_order_relations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_client_id uuid;
  v_asset_client_id uuid;
  v_asset_site_id uuid;
  v_assigned_is_member boolean;
  v_contract_client_id uuid;
  v_source_quote_client_id uuid;
  v_source_activity_client_id uuid;
begin
  if new.site_id is not null then
    select s.client_id into v_site_client_id
    from public.sites s
    where s.id = new.site_id;

    if v_site_client_id is null then
      raise exception 'work_orders.site_id % does not reference an existing site', new.site_id
        using errcode = '23503';
    elsif v_site_client_id <> new.client_id then
      raise exception 'work_orders.site_id must belong to the same client as the work order'
        using errcode = '23514';
    end if;
  end if;

  if new.asset_id is not null then
    select a.client_id, a.site_id into v_asset_client_id, v_asset_site_id
    from public.assets a
    where a.id = new.asset_id;

    if v_asset_client_id is null then
      raise exception 'work_orders.asset_id % does not reference an existing asset', new.asset_id
        using errcode = '23503';
    elsif v_asset_client_id <> new.client_id then
      raise exception 'work_orders.asset_id must belong to the same client as the work order'
        using errcode = '23514';
    elsif new.site_id is not null and v_asset_site_id <> new.site_id then
      raise exception 'work_orders.asset_id must belong to the same site as the work order (when site_id is set)'
        using errcode = '23514';
    end if;
  end if;

  if new.assigned_to is not null then
    select exists (
      select 1
      from public.memberships m
      where m.user_id = new.assigned_to
        and m.organization_id = new.organization_id
    ) into v_assigned_is_member;

    if not v_assigned_is_member then
      raise exception 'work_orders.assigned_to must be a member of the same organization as the work order'
        using errcode = '23514';
    end if;
  end if;

  if new.contract_id is not null then
    select client_id into v_contract_client_id
    from public.contracts
    where id = new.contract_id;

    if v_contract_client_id is null then
      raise exception 'work_orders.contract_id % does not reference an existing contract', new.contract_id
        using errcode = '23503';
    elsif v_contract_client_id <> new.client_id then
      raise exception 'work_orders.contract_id must belong to the same client as the work order'
        using errcode = '23514';
    end if;
  end if;

  if new.source_quote_id is not null then
    select client_id into v_source_quote_client_id
    from public.quotes
    where id = new.source_quote_id;

    if v_source_quote_client_id is null then
      raise exception 'work_orders.source_quote_id % does not reference an existing quote', new.source_quote_id
        using errcode = '23503';
    elsif v_source_quote_client_id <> new.client_id then
      raise exception 'work_orders.source_quote_id must belong to the same client as the work order'
        using errcode = '23514';
    end if;
  end if;

  if new.source_activity_id is not null then
    select client_id into v_source_activity_client_id
    from public.activities
    where id = new.source_activity_id;

    if v_source_activity_client_id is null then
      raise exception 'work_orders.source_activity_id % does not reference an existing activity', new.source_activity_id
        using errcode = '23503';
    elsif v_source_activity_client_id <> new.client_id then
      raise exception 'work_orders.source_activity_id must belong to the same client as the work order'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_work_order_relations() is
  'BEFORE INSERT/UPDATE OF client_id, site_id, asset_id, assigned_to, contract_id, source_quote_id, source_activity_id trigger on public.work_orders: rejects a site_id/asset_id/contract_id/source_quote_id/source_activity_id from a different client than the work order''s own client_id, an asset_id from a different site than the work order''s own site_id (when both are set), and an assigned_to user who is not a member of the work order''s own organization. Extended in 20260824090000_quotes_core.sql with the source_quote_id check, and in 20260829090000_work_orders_source_activity_id.sql with the source_activity_id check. Runs after derive_work_order_organization_id (alphabetically later trigger name, same timing), so new.organization_id is already final.';

drop trigger if exists work_orders_validate_relations on public.work_orders;

create trigger work_orders_validate_relations
  before insert or update of client_id, site_id, asset_id, assigned_to, contract_id, source_quote_id, source_activity_id on public.work_orders
  for each row execute function public.validate_work_order_relations();

grant insert (source_activity_id) on public.work_orders to authenticated;
grant update (source_activity_id) on public.work_orders to authenticated;
