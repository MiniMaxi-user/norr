-- Issues #243/#244/#246 (epic #242): modules per tenant. Adds the module
-- catalog (platform-level reference table), per-organization feature rows, the
-- platform-wide default bundle, the RPCs that change/list them, the new-org
-- trigger and a backfill. Also makes the DB-side counter reading requirements
-- (complete_contract_end, remove_contract_asset,
-- contract_missing_baseline_readings_at) apply only when the organization has
-- the `meters` module enabled.
--
-- Design notes:
--
-- 1. feature_catalog is NOT tenant data (no organization_id): one row per module
--    key with tier (core = always on, addon = switchable), requires (add-on keys
--    that must be enabled too), shipped (a non-shipped key can never be
--    enabled) and a display label/sort_order. KEEP IN SYNC with
--    lib/rbac/module-catalog.ts (UI source; a vitest test pins it) and
--    SHIPPED_FEATURES in lib/rbac/features.ts. `label` is an addition to the
--    spec'd columns: the validation error messages name modules by label.
--    `reporting`, `billing` and `platform` are deliberately not seeded.
-- 2. organization_features (organization_id, feature_key) is read under the
--    user's RLS by lib/rbac/features.ts (members of the org + platform
--    admins). No write grants: changes only via set_organization_features
--    (platform admin).
-- 3. platform_default_features is the bundle copied to NEW organizations by
--    the AFTER INSERT trigger (core always enabled regardless of this table).
--    Changing it never touches existing organizations. Readable by platform
--    admins only; written only via set_platform_default_features.
-- 4. There was no platform-admin helper yet (users.is_platform_admin is not
--    reachable from client grants), so public.is_platform_admin() is added:
--    SECURITY DEFINER, stable, false for anonymous callers.
-- 5. One validator (validate_feature_change_set) serves both RPCs. It takes the
--    current {key: bool} map and the change set, returns the merged map, and
--    raises 23514 on: unknown key, non-boolean value, disabling a core module,
--    enabling a non-shipped module, enabling an add-on whose requirements are
--    not enabled after the change set, disabling a module that an enabled
--    add-on requires.
-- 6. Meters off: complete_contract_end ignores p_readings (no closing readings
--    are inserted), remove_contract_asset asks for / inserts no closing
--    readings, contract_missing_baseline_readings_at returns no rows. Bodies
--    copied forward from 20261124100000 / 20261126090000 (the latest
--    definitions); the only change is the meters condition.

-- ===========================================================================
-- A. Helpers
-- ===========================================================================
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select u.is_platform_admin from public.users u where u.id = auth.uid()),
    false
  );
$$;

comment on function public.is_platform_admin() is
  'True when the caller is a platform admin (users.is_platform_admin). SECURITY DEFINER because the column is not client-readable; false for anonymous callers.';

revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

-- ===========================================================================
-- B. feature_catalog
-- ===========================================================================
create table public.feature_catalog (
  feature_key text primary key,
  label text not null,
  tier text not null check (tier in ('core', 'addon')),
  requires text[] not null default '{}',
  shipped boolean not null,
  sort_order int not null
);

comment on table public.feature_catalog is
  'Platform-level module catalog (not tenant data, no organization_id). Enforcement source for the module rules; KEEP IN SYNC with lib/rbac/module-catalog.ts.';

alter table public.feature_catalog enable row level security;

create policy "feature_catalog_select_authenticated"
on public.feature_catalog
for select
to authenticated
using (true);

revoke all on public.feature_catalog from public, anon, authenticated;
grant select on public.feature_catalog to authenticated;

insert into public.feature_catalog (feature_key, label, tier, requires, shipped, sort_order) values
  ('dashboard', 'Dashboard', 'core', '{}', true, 1),
  ('clients', 'Clients', 'core', '{}', true, 2),
  ('assets', 'Assets', 'core', '{}', true, 3),
  ('articles', 'Articles', 'core', '{}', true, 4),
  ('activities', 'Activities', 'core', '{}', true, 5),
  ('planning', 'Planning', 'core', '{}', true, 6),
  ('settings', 'Settings', 'core', '{}', true, 7),
  ('contracts', 'Contracts', 'addon', '{}', true, 8),
  ('quotes', 'Quotes', 'addon', '{}', true, 9),
  ('invoicing', 'Invoicing', 'addon', '{quotes}', true, 10),
  ('checklists', 'Checklists', 'addon', '{}', true, 11),
  ('inventory', 'Inventory', 'addon', '{}', true, 12),
  ('meters', 'Meters', 'addon', '{}', true, 13),
  ('preventive_maintenance', 'Preventive maintenance', 'addon', '{contracts,planning}', false, 14);

-- ===========================================================================
-- C. organization_features
-- ===========================================================================
create table public.organization_features (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  feature_key text not null references public.feature_catalog (feature_key),
  enabled boolean not null,
  source text not null check (source in ('manual', 'stripe', 'default')),
  updated_by uuid references public.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, feature_key)
);

create index organization_features_feature_key_idx on public.organization_features (feature_key);
create index organization_features_updated_by_idx on public.organization_features (updated_by);

comment on table public.organization_features is
  'Per-organization module switches (issue #243). Members read their own organization''s rows, platform admins read all; writes only via set_organization_features.';

alter table public.organization_features enable row level security;

create policy "organization_features_select_member_or_platform_admin"
on public.organization_features
for select
to authenticated
using (public.is_member_of_org(organization_id) or public.is_platform_admin());

revoke all on public.organization_features from public, anon, authenticated;
grant select on public.organization_features to authenticated;

-- ===========================================================================
-- D. platform_default_features
-- ===========================================================================
create table public.platform_default_features (
  feature_key text primary key references public.feature_catalog (feature_key),
  enabled boolean not null,
  updated_by uuid references public.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create index platform_default_features_updated_by_idx on public.platform_default_features (updated_by);

comment on table public.platform_default_features is
  'Platform-wide default module bundle copied to NEW organizations (issue #246). Never applied to existing organizations. Platform admins read; writes only via set_platform_default_features.';

alter table public.platform_default_features enable row level security;

create policy "platform_default_features_select_platform_admin"
on public.platform_default_features
for select
to authenticated
using (public.is_platform_admin());

revoke all on public.platform_default_features from public, anon, authenticated;
grant select on public.platform_default_features to authenticated;

insert into public.platform_default_features (feature_key, enabled)
select feature_key, shipped from public.feature_catalog;

-- ===========================================================================
-- E. organization_has_feature + validator
-- ===========================================================================
create or replace function public.organization_has_feature(p_org uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_features f
    where f.organization_id = p_org and f.feature_key = p_key and f.enabled
  );
$$;

comment on function public.organization_has_feature(uuid, text) is
  'True iff an enabled organization_features row exists for the organization and key. SECURITY DEFINER, stable; does not check the caller''s membership (it only answers a boolean used inside RLS-bound functions).';

revoke all on function public.organization_has_feature(uuid, text) from public, anon;
grant execute on function public.organization_has_feature(uuid, text) to authenticated;

-- Returns the merged {key: bool} map (current overlaid with the change set).
create or replace function public.validate_feature_change_set(p_current jsonb, p_changes jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_merged jsonb := coalesce(p_current, '{}'::jsonb);
  v_key text;
  v_val jsonb;
  c public.feature_catalog%rowtype;
  v_req text;
  v_req_label text;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'The module changes must be an object of {key: boolean}.' using errcode = '23514';
  end if;

  for v_key, v_val in select * from jsonb_each(p_changes) loop
    select * into c from public.feature_catalog where feature_key = v_key;
    if not found then
      raise exception 'Unknown module "%".', v_key using errcode = '23514';
    end if;
    if jsonb_typeof(v_val) <> 'boolean' then
      raise exception 'The value for module "%" must be true or false.', v_key using errcode = '23514';
    end if;
    if c.tier = 'core' and v_val = 'false'::jsonb then
      raise exception '% is a core module and can''t be disabled', c.label using errcode = '23514';
    end if;
    if v_val = 'true'::jsonb
       and coalesce(p_current -> v_key, 'false'::jsonb) <> 'true'::jsonb
       and not c.shipped then
      raise exception '% isn''t available yet', c.label using errcode = '23514';
    end if;
    v_merged := v_merged || jsonb_build_object(v_key, v_val);
  end loop;

  -- Dependencies, evaluated on the merged state.
  for c in select * from public.feature_catalog where feature_key in (
    select e.k from jsonb_each(v_merged) e(k, v) where e.v = 'true'::jsonb
  ) loop
    foreach v_req in array c.requires loop
      if coalesce(v_merged -> v_req, 'false'::jsonb) <> 'true'::jsonb then
        select label into v_req_label from public.feature_catalog where feature_key = v_req;
        if p_changes ? c.feature_key and coalesce(p_current -> c.feature_key, 'false'::jsonb) <> 'true'::jsonb then
          raise exception '% requires %', c.label, v_req_label using errcode = '23514';
        else
          raise exception '% can''t be disabled while % is enabled', v_req_label, c.label using errcode = '23514';
        end if;
      end if;
    end loop;
  end loop;

  return v_merged;
end;
$$;

comment on function public.validate_feature_change_set(jsonb, jsonb) is
  'Validates a module change set against the catalog and returns the merged {key: bool} map. 23514 on: unknown key, non-boolean value, "<Label> is a core module and can''t be disabled", "<Label> isn''t available yet" (enabling a non-shipped module), "<Label> requires <Required>", "<Required> can''t be disabled while <Label> is enabled". SECURITY INVOKER (reads only feature_catalog); internal, not granted to clients.';

revoke all on function public.validate_feature_change_set(jsonb, jsonb) from public, anon, authenticated;

-- ===========================================================================
-- F. RPCs
-- ===========================================================================
create or replace function public.set_organization_features(p_organization_id uuid, p_changes jsonb)
returns setof public.organization_features
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current jsonb;
  v_merged jsonb;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Only a platform admin can change an organization''s modules.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'Organization not found.' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_object_agg(feature_key, enabled), '{}'::jsonb) into v_current
  from public.organization_features where organization_id = p_organization_id;

  v_merged := public.validate_feature_change_set(v_current, p_changes);

  return query
  insert into public.organization_features as f (organization_id, feature_key, enabled, source, updated_by, updated_at)
  select p_organization_id, e.key, (e.value)::boolean, 'manual', auth.uid(), now()
  from jsonb_each(p_changes) e
  on conflict (organization_id, feature_key) do update
    set enabled = excluded.enabled, source = 'manual', updated_by = auth.uid(), updated_at = now()
  returning f.*;
end;
$$;

comment on function public.set_organization_features(uuid, jsonb) is
  'Issue #243: platform admin only (42501); P0002 organization not found; validates the change set {key: bool} (see validate_feature_change_set, 23514) and upserts every key in it with source ''manual'', updated_by = auth.uid(). Returns the upserted organization_features rows.';

revoke all on function public.set_organization_features(uuid, jsonb) from public, anon;
grant execute on function public.set_organization_features(uuid, jsonb) to authenticated;

create or replace function public.list_organization_features(p_organization_id uuid)
returns table (
  feature_key text,
  label text,
  tier text,
  requires text[],
  shipped boolean,
  sort_order int,
  enabled boolean,
  source text,
  updated_at timestamptz,
  updated_by_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or not (public.is_platform_admin() or public.is_member_of_org(p_organization_id)) then
    raise exception 'You do not have access to this organization''s modules.' using errcode = '42501';
  end if;

  return query
  select c.feature_key, c.label, c.tier, c.requires, c.shipped, c.sort_order,
         coalesce(f.enabled, false), f.source, f.updated_at,
         coalesce(nullif(btrim(u.full_name), ''), u.email)
  from public.feature_catalog c
  left join public.organization_features f
    on f.feature_key = c.feature_key and f.organization_id = p_organization_id
  left join public.users u on u.id = f.updated_by
  order by c.sort_order;
end;
$$;

comment on function public.list_organization_features(uuid) is
  'Issue #243: every catalog key (left join) for the organization: feature_key, label, tier, requires, shipped, sort_order, enabled (false when no row), source and updated_at (null when no row), updated_by_name (full name, else email, else null). Platform admin or member of the organization (42501 otherwise). Ordered by sort_order.';

revoke all on function public.list_organization_features(uuid) from public, anon;
grant execute on function public.list_organization_features(uuid) to authenticated;

create or replace function public.set_platform_default_features(p_changes jsonb)
returns setof public.platform_default_features
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current jsonb;
  v_merged jsonb;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Only a platform admin can change the default modules.' using errcode = '42501';
  end if;

  select coalesce(jsonb_object_agg(feature_key, enabled), '{}'::jsonb) into v_current
  from public.platform_default_features;

  v_merged := public.validate_feature_change_set(v_current, p_changes);

  return query
  insert into public.platform_default_features as d (feature_key, enabled, updated_by, updated_at)
  select e.key, (e.value)::boolean, auth.uid(), now()
  from jsonb_each(p_changes) e
  on conflict (feature_key) do update
    set enabled = excluded.enabled, updated_by = auth.uid(), updated_at = now()
  returning d.*;
end;
$$;

comment on function public.set_platform_default_features(jsonb) is
  'Issue #246: platform admin only (42501); validates the change set like set_organization_features (23514) and upserts the default bundle for NEW organizations. Never touches existing organizations. Returns the upserted rows.';

revoke all on function public.set_platform_default_features(jsonb) from public, anon;
grant execute on function public.set_platform_default_features(jsonb) to authenticated;

create or replace function public.list_platform_default_features()
returns table (
  feature_key text,
  label text,
  tier text,
  requires text[],
  shipped boolean,
  sort_order int,
  enabled boolean,
  updated_at timestamptz,
  updated_by_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Only a platform admin can read the default modules.' using errcode = '42501';
  end if;

  return query
  select c.feature_key, c.label, c.tier, c.requires, c.shipped, c.sort_order,
         coalesce(d.enabled, false), d.updated_at,
         coalesce(nullif(btrim(u.full_name), ''), u.email)
  from public.feature_catalog c
  left join public.platform_default_features d on d.feature_key = c.feature_key
  left join public.users u on u.id = d.updated_by
  order by c.sort_order;
end;
$$;

comment on function public.list_platform_default_features() is
  'Issue #246: every catalog key with the default bundle value (enabled false when no row), updated_at, updated_by_name. Platform admin only (42501).';

revoke all on function public.list_platform_default_features() from public, anon;
grant execute on function public.list_platform_default_features() to authenticated;

-- ===========================================================================
-- G. New-organization trigger + backfill
-- ===========================================================================
create or replace function public.handle_new_organization_seed_features()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.organization_features (organization_id, feature_key, enabled, source)
  select new.id, c.feature_key,
         case when c.tier = 'core' then true
              else coalesce(d.enabled, false) and c.shipped end,
         'default'
  from public.feature_catalog c
  left join public.platform_default_features d on d.feature_key = c.feature_key
  on conflict (organization_id, feature_key) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_organization_seed_features() is
  'AFTER INSERT trigger on organizations: one organization_features row per catalog key, source ''default''. Core is always enabled; add-ons follow platform_default_features (never enabling a non-shipped key).';

create trigger organizations_seed_features
  after insert on public.organizations
  for each row execute function public.handle_new_organization_seed_features();

-- Backfill: core + every shipped add-on (incl. meters) enabled, the rest off.
insert into public.organization_features (organization_id, feature_key, enabled, source)
select o.id, c.feature_key, c.shipped, 'default'
from public.organizations o
cross join public.feature_catalog c
on conflict (organization_id, feature_key) do nothing;

-- ===========================================================================
-- H. Meters-gated counter reading requirements
-- ===========================================================================
-- complete_contract_end: body from 20261124100000 + meters condition.
create or replace function public.complete_contract_end(
  p_contract_id uuid,
  p_end_date date,
  p_readings jsonb,
  p_quote jsonb,
  p_lines jsonb,
  p_settlements jsonb,
  p_delete_quote_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract public.contracts%rowtype;
  v_today date := (now() at time zone 'UTC')::date;
  v_quote_id uuid;
  v_read_at timestamptz;
  r record;
  l record;
  s record;
  v_del uuid;
  v_meters boolean;
begin
  select * into v_contract from public.contracts where id = p_contract_id for update;
  if not found then
    raise exception 'Contract not found.' using errcode = 'P0002';
  end if;

  if auth.uid() is null
     or coalesce(public.current_member_role(v_contract.organization_id) not in ('owner', 'finance'), true) then
    raise exception 'Only an owner or finance member can end a contract.' using errcode = '42501';
  end if;

  v_meters := public.organization_has_feature(v_contract.organization_id, 'meters');

  if v_contract.status = 'draft' then
    raise exception 'A draft contract cannot be ended.' using errcode = '23514';
  end if;
  if v_contract.status = 'ended' and (
       exists (select 1 from public.quotes q where q.contract_id = p_contract_id and q.is_final_settlement)
       or exists (select 1 from public.contract_counter_settlements cs where cs.contract_id = p_contract_id and cs.is_final)
     ) then
    raise exception 'This contract already has a final balance.' using errcode = '23514';
  end if;

  if p_end_date is null or p_end_date < v_contract.start_date or p_end_date > v_today then
    raise exception 'The end date must be between the contract start date and today.' using errcode = '23514';
  end if;

  -- Race guard: contract quotes created after the balance was computed (e.g. by
  -- a concurrent "Generate contract quotes") that this call would not replace.
  if exists (
    select 1 from public.quotes q
    where q.contract_id = p_contract_id
      and q.quote_type = 'contract'
      and not (q.id = any (coalesce(p_delete_quote_ids, '{}'::uuid[])))
      and not exists (select 1 from public.invoices i where i.quote_id = q.id)
      and (
        (not q.is_final_settlement and not q.is_counter_settlement and q.contract_period_start <= p_end_date)
        or (q.is_counter_settlement
            and q.counter_settlement_end > (
              select min((e ->> 'period_start')::date) from jsonb_array_elements(coalesce(p_settlements, '[]'::jsonb)) e
            ) - 1)
      )
  ) then
    raise exception 'New contract quotes were created meanwhile; reload the final balance.' using errcode = '23514';
  end if;

  -- Closing readings (noon UTC on the end date), same triggers as any reading.
  v_read_at := (p_end_date::timestamp + interval '12 hours') at time zone 'UTC';
  for r in
    select (e ->> 'asset_id')::uuid as asset_id,
           (e ->> 'volume_item_id')::uuid as volume_item_id,
           (e ->> 'value')::numeric as value
    from jsonb_array_elements(coalesce(p_readings, '[]'::jsonb)) e
    where v_meters  -- meters module off: no closing readings are stored
  loop
    if r.asset_id is null or r.volume_item_id is null or r.value is null then
      raise exception 'Every closing reading needs asset_id, volume_item_id and value.' using errcode = '23514';
    end if;
    if not exists (select 1 from public.contract_covered_assets(p_contract_id) cv where cv.asset_id = r.asset_id) then
      raise exception 'Asset % is not covered by this contract.', r.asset_id using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.contract_line_items cl
      where cl.contract_id = p_contract_id and cl.is_volume and cl.volume_item_id = r.volume_item_id
    ) then
      raise exception 'Counter % is not a counter of this contract.', r.volume_item_id using errcode = '23514';
    end if;

    insert into public.asset_volume_readings (asset_id, volume_item_id, value, read_at, needs_review)
    values (r.asset_id, r.volume_item_id, r.value, v_read_at, false);
  end loop;

  -- Un-invoiced period/counter quotes replaced by the final quote.
  foreach v_del in array coalesce(p_delete_quote_ids, '{}'::uuid[]) loop
    if not exists (
      select 1 from public.quotes q
      where q.id = v_del and q.contract_id = p_contract_id and q.quote_type = 'contract'
    ) then
      raise exception 'Quote % is not a contract quote of this contract.', v_del using errcode = '23514';
    end if;
    if exists (select 1 from public.invoices i where i.quote_id = v_del) then
      raise exception 'Quote % has been invoiced and cannot be replaced.', v_del using errcode = '23514';
    end if;
    delete from public.quotes where id = v_del;
  end loop;

  -- Final settlement quote.
  if p_quote is not null and jsonb_typeof(p_quote) = 'object' then
    if btrim(coalesce(p_quote ->> 'name', '')) = '' then
      raise exception 'The final settlement quote needs a name.' using errcode = '23514';
    end if;
    if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
      raise exception 'The final settlement quote needs at least one line.' using errcode = '23514';
    end if;

    insert into public.quotes (
      client_id, name, notes, quote_type, contract_id,
      contract_period_start, contract_period_end,
      counter_settlement_start, counter_settlement_end, is_final_settlement
    )
    values (
      v_contract.client_id,
      p_quote ->> 'name',
      p_quote ->> 'notes',
      'contract',
      p_contract_id,
      (p_quote ->> 'contract_period_start')::date,
      (p_quote ->> 'contract_period_end')::date,
      (p_quote ->> 'counter_settlement_start')::date,
      (p_quote ->> 'counter_settlement_end')::date,
      true
    )
    returning id into v_quote_id;

    for l in
      select (e ->> 'article_id')::uuid as article_id,
             e ->> 'article_number' as article_number,
             coalesce(e ->> 'description', '') as description,
             coalesce((e ->> 'quantity')::numeric, 1) as quantity,
             coalesce((e ->> 'unit_price')::numeric, 0) as unit_price,
             coalesce((e ->> 'sort_order')::int, 0) as sort_order
      from jsonb_array_elements(p_lines) e
    loop
      insert into public.quote_line_items (quote_id, article_id, article_number, description, quantity, unit_price, sort_order)
      values (v_quote_id, l.article_id, l.article_number, l.description, l.quantity, l.unit_price, l.sort_order);
    end loop;
  end if;

  -- Final ledger rows.
  for s in
    select (e ->> 'period_start')::date as period_start,
           (e ->> 'period_end')::date as period_end,
           coalesce(e -> 'details', '[]'::jsonb) as details
    from jsonb_array_elements(coalesce(p_settlements, '[]'::jsonb)) e
  loop
    if s.period_start is null or s.period_end is null or s.period_end > p_end_date then
      raise exception 'Settlement windows need a start and an end on or before the end date.' using errcode = '23514';
    end if;
    insert into public.contract_counter_settlements (contract_id, period_start, period_end, quote_id, is_final, details)
    values (p_contract_id, s.period_start, s.period_end, v_quote_id, true, s.details);
  end loop;

  update public.contracts
  set status = 'ended',
      end_date = p_end_date,
      end_scheduled_at = null,
      end_date_before_scheduling = null
  where id = p_contract_id;

  return v_quote_id;
end;
$$;

comment on function public.complete_contract_end(uuid, date, jsonb, jsonb, jsonb, jsonb, uuid[]) is
  'Issue #271: atomically completes a contract''s final balance (see 20261124090000) plus a race guard (20261124100000): 23514 "New contract quotes were created meanwhile; reload the final balance." when an un-invoiced period quote with contract_period_start <= p_end_date, or an un-invoiced counter settlement quote overlapping the settled windows, is not in p_delete_quote_ids. Owner/finance only (42501). When the organization does not have the `meters` module enabled, p_readings is ignored (20261126100000).';

revoke all on function public.complete_contract_end(uuid, date, jsonb, jsonb, jsonb, jsonb, uuid[]) from public, anon;
grant execute on function public.complete_contract_end(uuid, date, jsonb, jsonb, jsonb, jsonb, uuid[]) to authenticated;

-- contract_missing_baseline_readings_at: body from 20261126090000 + meters condition.
create or replace function public.contract_missing_baseline_readings_at(
  p_contract_id uuid,
  p_start_date date
)
returns table (asset_id uuid, asset_name text, volume_item_id uuid, counter_label text)
language sql
stable
security invoker
set search_path = public
as $$
  select a.id, a.name, amv.volume_item_id, rli.label
    from (select distinct cv.asset_id from public.contract_covered_assets(p_contract_id) cv
           where cv.coverage_end is null) cov
    join public.assets a on a.id = cov.asset_id
    join public.asset_model_volumes amv on amv.asset_model_id = a.model_id
    join public.reference_list_items rli on rli.id = amv.volume_item_id
    where public.organization_has_feature(
        (select c.organization_id from public.contracts c where c.id = p_contract_id), 'meters')
      and exists (
        select 1 from public.contract_line_items cl
        where cl.contract_id = p_contract_id
          and cl.is_volume
          and cl.volume_item_id = amv.volume_item_id
      )
      and not exists (
        select 1 from public.asset_volume_readings r
        where r.asset_id = a.id
          and r.volume_item_id = amv.volume_item_id
          and not r.needs_review
          and r.read_at <= (((p_start_date + 1)::timestamp at time zone 'UTC') - interval '1 millisecond')
      )
    order by a.name, rli.label;
$$;

comment on function public.contract_missing_baseline_readings_at(uuid, date) is
  'Issue #270 internal variant of contract_missing_baseline_readings taking the start date explicitly (the activation trigger must use the NEW start_date). Day boundary is UTC (end of the start date, 23:59:59.999Z), like the app. Only open coverage windows (issue #274). Returns nothing when the organization does not have the `meters` module enabled (20261126100000). SECURITY INVOKER, stable.';

revoke all on function public.contract_missing_baseline_readings_at(uuid, date) from public, anon;
grant execute on function public.contract_missing_baseline_readings_at(uuid, date) to authenticated;


-- remove_contract_asset: body from 20261126090000 + meters condition.
create or replace function public.remove_contract_asset(
  p_contract_id uuid,
  p_asset_id uuid,
  p_removed_on date,
  p_readings jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract public.contracts%rowtype;
  v_link public.contract_assets%rowtype;
  v_today date := (now() at time zone 'UTC')::date;
  v_cov_start date;
  v_settled date;
  v_read_at timestamptz;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_missing text;
  v_meters boolean;
  r record;
begin
  select * into v_contract from public.contracts where id = p_contract_id for update;
  if not found then
    raise exception 'Contract not found.' using errcode = 'P0002';
  end if;

  if auth.uid() is null
     or coalesce(public.current_member_role(v_contract.organization_id) not in ('owner', 'finance'), true) then
    raise exception 'Only an owner or finance member can remove an asset from a contract.' using errcode = '42501';
  end if;

  v_meters := public.organization_has_feature(v_contract.organization_id, 'meters');

  if v_contract.status = 'ended' then
    raise exception 'An asset cannot be removed from an ended contract.' using errcode = '23514';
  end if;

  select * into v_link
  from public.contract_assets ca
  where ca.contract_id = p_contract_id and ca.asset_id = p_asset_id and ca.removed_on is null;
  if not found then
    raise exception 'This asset is not linked to the contract.' using errcode = 'P0002';
  end if;

  if v_contract.status = 'draft' then
    delete from public.contract_assets where id = v_link.id;
    return;
  end if;

  -- Active contract.
  if p_removed_on is null then
    raise exception 'A removal date is required.' using errcode = '23514';
  end if;

  v_cov_start := greatest(v_contract.start_date, coalesce(v_link.added_on, v_contract.start_date));
  if p_removed_on < v_cov_start or p_removed_on > v_today then
    raise exception 'The removal date must be between the coverage start (%) and today (%).', v_cov_start, v_today
      using errcode = '23514';
  end if;

  select max(cs.period_end) into v_settled
  from public.contract_counter_settlements cs
  where cs.contract_id = p_contract_id;
  if v_settled is not null and p_removed_on <= v_settled then
    raise exception 'The removal date must be after the last settled counter period (ending %).', v_settled
      using errcode = '23514';
  end if;

  v_read_at := (p_removed_on::timestamp + interval '12 hours') at time zone 'UTC';
  v_day_start := p_removed_on::timestamp at time zone 'UTC';
  v_day_end := (p_removed_on + 1)::timestamp at time zone 'UTC';

  -- Closing readings supplied by the caller.
  for r in
    select (e ->> 'asset_id')::uuid as asset_id,
           (e ->> 'volume_item_id')::uuid as volume_item_id,
           (e ->> 'value')::numeric as value
    from jsonb_array_elements(coalesce(p_readings, '[]'::jsonb)) e
    where v_meters  -- meters module off: no closing readings are stored
  loop
    if r.asset_id is null or r.volume_item_id is null or r.value is null then
      raise exception 'Every closing reading needs asset_id, volume_item_id and value.' using errcode = '23514';
    end if;
    if not exists (
      select 1
      from public.contract_covered_assets(p_contract_id) cv
      join public.assets a on a.id = cv.asset_id
      join public.asset_model_volumes amv on amv.asset_model_id = a.model_id
      where cv.contract_asset_id = v_link.id
        and cv.asset_id = r.asset_id
        and amv.volume_item_id = r.volume_item_id
        and exists (
          select 1 from public.contract_line_items cl
          where cl.contract_id = p_contract_id and cl.is_volume and cl.volume_item_id = r.volume_item_id
        )
    ) then
      raise exception 'Asset % / counter % is not a counter reading required for this removal.', r.asset_id, r.volume_item_id
        using errcode = '23514';
    end if;

    if not exists (
      select 1 from public.asset_volume_readings x
      where x.asset_id = r.asset_id and x.volume_item_id = r.volume_item_id
        and not x.needs_review and x.read_at >= v_day_start and x.read_at < v_day_end
    ) then
      insert into public.asset_volume_readings (asset_id, volume_item_id, value, read_at, needs_review)
      values (r.asset_id, r.volume_item_id, r.value, v_read_at, false);
    end if;
  end loop;

  -- Every (covered asset incl. components x counter of a volume line) needs an
  -- accepted reading on the removal date.
  select string_agg(a.name || ' – ' || rli.label, ', ' order by a.name, rli.label)
    into v_missing
  from public.contract_covered_assets(p_contract_id) cv
  join public.assets a on a.id = cv.asset_id
  join public.asset_model_volumes amv on amv.asset_model_id = a.model_id
  join public.reference_list_items rli on rli.id = amv.volume_item_id
  where v_meters
    and cv.contract_asset_id = v_link.id
    and exists (
      select 1 from public.contract_line_items cl
      where cl.contract_id = p_contract_id and cl.is_volume and cl.volume_item_id = amv.volume_item_id
    )
    and not exists (
      select 1 from public.asset_volume_readings x
      where x.asset_id = a.id and x.volume_item_id = amv.volume_item_id
        and not x.needs_review and x.read_at >= v_day_start and x.read_at < v_day_end
    );

  if v_missing is not null then
    raise exception 'Missing closing readings: %', v_missing using errcode = '23514';
  end if;

  update public.contract_assets
  set removed_on = p_removed_on,
      removed_at = now(),
      removed_by = auth.uid()
  where id = v_link.id;
end;
$$;

comment on function public.remove_contract_asset(uuid, uuid, date, jsonb) is
  'Issue #274: removes an asset from a contract. SECURITY DEFINER; owner/finance only (42501); P0002 contract not found / asset not linked (open link). Draft: plain delete of the open link (date and readings ignored). Ended: 23514 ''An asset cannot be removed from an ended contract.'' Active: p_removed_on (LAST covered day) must lie between the link''s coverage start and today (UTC) and after the last settled counter window (23514); a closing reading is REQUIRED on that date for every covered asset (incl. components) x counter of a volume line the model has: either already an accepted reading that day or one in p_readings [{asset_id, volume_item_id, value}] (inserted at noon UTC through the normal reading triggers); else 23514 ''Missing closing readings: <asset> – <counter>, ...''. Then sets removed_on/removed_at/removed_by. When the organization does not have the `meters` module enabled, no closing readings are required and p_readings is ignored (20261126100000). Returns void.';

revoke all on function public.remove_contract_asset(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.remove_contract_asset(uuid, uuid, date, jsonb) to authenticated;

