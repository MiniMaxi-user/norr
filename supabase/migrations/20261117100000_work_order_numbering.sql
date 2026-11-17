-- Work order numbering (issue #218).
--
-- Every work order gets a system-assigned, immutable, per-tenant number of the
-- form <prefix><next_number> with no zero padding (WO100, WO2872).
-- `work_orders.title` becomes the optional `external_reference`.
-- Mirrors contract numbering (20261013090000 + 20261117090000), including the
-- prefix charset A-Z 0-9 - _ . / and the literal prefix comparison.
--
-- Design notes:
-- 1. `work_order_number_sequences` (one row per org: prefix, next_number) is the
--    counter + settings table. RLS is enabled and forced with zero policies and
--    no grants: all access goes through SECURITY DEFINER functions.
-- 2. work_orders_set_work_order_number (BEFORE INSERT) always overwrites
--    new.work_order_number from the sequence, locking the org's sequence row
--    (FOR UPDATE), so concurrent inserts in one org are serialized and never
--    duplicate. It sorts after work_orders_derive_organization_id, so
--    organization_id is final. work_order_number is never granted to
--    authenticated (new columns get no column grant) and a BEFORE UPDATE
--    trigger rejects any change.
-- 3. Settings are read/written via get_work_order_numbering_settings() and
--    update_work_order_numbering_settings() (owner/administratie only).
-- 4. Backfill numbers existing work orders per org by (created_at, id) from 100.
-- 5. Rename title -> external_reference: column-level grants follow a rename
--    automatically. The only DB objects that read work_orders.title were the
--    work order auto-draft quote trigger function (re-created below to use the
--    work order number instead); no views/other functions reference it.

-- ---------------------------------------------------------------------------
-- 1. Sequence/settings table.
-- ---------------------------------------------------------------------------
create table public.work_order_number_sequences (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  prefix text not null default 'WO',
  next_number integer not null default 100,
  updated_at timestamptz not null default now(),
  constraint work_order_number_sequences_prefix_format check (prefix ~ '^[A-Z0-9._/-]{1,10}$'),
  constraint work_order_number_sequences_next_number_range check (next_number between 1 and 2000000000)
);

comment on table public.work_order_number_sequences is
  'Per-organization work order numbering settings + counter (issue #218): prefix (1-10 chars: A-Z, 0-9, - _ . /, default WO) and next_number (default 100). The next work order gets prefix || next_number, then next_number is incremented under a row lock. RLS enabled/forced with no policies and no grants: read/written only through get_work_order_numbering_settings(), update_work_order_numbering_settings() and the work_orders_set_work_order_number trigger (all SECURITY DEFINER).';
comment on column public.work_order_number_sequences.prefix is
  'Prefix for newly issued work order numbers. 1-10 chars: A-Z, 0-9 and - _ . /. Changing it never renumbers existing work orders.';
comment on column public.work_order_number_sequences.next_number is
  'The number the next work order will receive (no zero padding). Can only be raised via update_work_order_numbering_settings().';

alter table public.work_order_number_sequences enable row level security;
alter table public.work_order_number_sequences force row level security;
revoke all on public.work_order_number_sequences from authenticated, anon;

create trigger work_order_number_sequences_set_updated_at
  before update on public.work_order_number_sequences
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. work_orders: rename title -> external_reference (nullable), add number.
-- ---------------------------------------------------------------------------
alter table public.work_orders rename column title to external_reference;
alter table public.work_orders alter column external_reference drop not null;

comment on column public.work_orders.external_reference is
  'Optional free-text external reference (e.g. the customer''s own ticket/PO number or a short description). Formerly work_orders.title; the work_order_number is now the primary identifier.';

alter table public.work_orders add column work_order_number text;

comment on column public.work_orders.work_order_number is
  'System-assigned per-tenant work order number, <prefix><next_number> (e.g. WO100), minted by the work_orders_set_work_order_number BEFORE INSERT trigger from work_order_number_sequences. Not client-writable (no INSERT/UPDATE column grant; UPDATE trigger rejects changes) and immutable. Unique per organization.';

-- ---------------------------------------------------------------------------
-- 3. Backfill existing work orders, then the sequences.
-- ---------------------------------------------------------------------------
with numbered as (
  select w.id,
         99 + row_number() over (partition by w.organization_id order by w.created_at, w.id) as n
  from public.work_orders w
)
update public.work_orders w
set work_order_number = 'WO' || numbered.n::text
from numbered
where numbered.id = w.id;

insert into public.work_order_number_sequences (organization_id, prefix, next_number)
select o.id, 'WO', 100 + coalesce(count(w.id), 0)
from public.organizations o
left join public.work_orders w on w.organization_id = o.id
group by o.id;

alter table public.work_orders alter column work_order_number set not null;
alter table public.work_orders
  add constraint work_orders_organization_id_work_order_number_key unique (organization_id, work_order_number);

-- ---------------------------------------------------------------------------
-- 4. Trigger: assign number on insert, forbid changes on update.
-- ---------------------------------------------------------------------------
create or replace function public.assign_work_order_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_next integer;
begin
  insert into public.work_order_number_sequences (organization_id)
  values (new.organization_id)
  on conflict (organization_id) do nothing;

  select s.prefix, s.next_number into v_prefix, v_next
  from public.work_order_number_sequences s
  where s.organization_id = new.organization_id
  for update;

  -- Defensive: skip numbers that already exist (cannot normally happen, the
  -- settings function guards against it).
  while exists (
    select 1 from public.work_orders w
    where w.organization_id = new.organization_id
      and w.work_order_number = v_prefix || v_next::text
  ) loop
    v_next := v_next + 1;
  end loop;

  new.work_order_number := v_prefix || v_next::text;

  update public.work_order_number_sequences s
  set next_number = v_next + 1
  where s.organization_id = new.organization_id;

  return new;
end;
$$;

comment on function public.assign_work_order_number() is
  'BEFORE INSERT trigger on public.work_orders: always overwrites work_order_number with <prefix><next_number> from the org''s work_order_number_sequences row (locked FOR UPDATE, so concurrent inserts in the same org serialize and never duplicate), then increments next_number. Sorts after work_orders_derive_organization_id so organization_id is final.';

revoke all on function public.assign_work_order_number() from public;

create trigger work_orders_set_work_order_number
  before insert on public.work_orders
  for each row execute function public.assign_work_order_number();

create or replace function public.prevent_work_order_number_change()
returns trigger
language plpgsql
as $$
begin
  if new.work_order_number is distinct from old.work_order_number then
    raise exception 'work_orders.work_order_number is immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.prevent_work_order_number_change() is
  'BEFORE UPDATE OF work_order_number trigger on public.work_orders: work order numbers are immutable once assigned (also blocks privileged roles).';

create trigger work_orders_prevent_work_order_number_change
  before update of work_order_number on public.work_orders
  for each row execute function public.prevent_work_order_number_change();

-- ---------------------------------------------------------------------------
-- 5. Auto-draft quote trigger function used new.title: name the shadow quote
--    after the work order number instead (external_reference is optional).
--    AFTER INSERT, so work_order_number is already minted.
-- ---------------------------------------------------------------------------
create or replace function public.create_work_order_auto_draft_quote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.quotes (client_id, work_order_id, name, is_auto_draft)
  values (new.client_id, new.id, 'Quote — ' || new.work_order_number, true);

  return new;
end;
$$;

comment on function public.create_work_order_auto_draft_quote() is
  'AFTER INSERT trigger on public.work_orders (issue #109): creates the linked is_auto_draft quote for every new work order, unconditionally, named ''Quote — <work_order_number>'' (since #218; previously the work order title). SECURITY DEFINER so this INSERT into quotes succeeds despite is_auto_draft being withheld from the client-facing INSERT grant, and regardless of the inserting role''s own quotes RLS privileges. client_id copied from the work order (no site: quotes are not linked to a site since 20261012090000); status_id left unset so derive_quote_organization_id fills in the org''s default quote_status.';

-- ---------------------------------------------------------------------------
-- 6. Settings API (owner/administratie only).
-- ---------------------------------------------------------------------------
create or replace function public.get_work_order_numbering_settings(p_organization_id uuid)
returns table (prefix text, next_number integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_member_role(p_organization_id) is null
     or public.current_member_role(p_organization_id) not in ('owner', 'administratie') then
    raise exception 'not allowed to read work order numbering settings'
      using errcode = '42501';
  end if;

  return query
  select s.prefix, s.next_number
  from public.work_order_number_sequences s
  where s.organization_id = p_organization_id;

  if not found then
    return query select 'WO'::text, 100;
  end if;
end;
$$;

comment on function public.get_work_order_numbering_settings(uuid) is
  'Returns (prefix, next_number) for the organization; defaults (WO, 100) when no row exists yet. owner/administratie only (42501 otherwise).';

create or replace function public.update_work_order_numbering_settings(
  p_organization_id uuid,
  p_prefix text,
  p_next_number integer
)
returns table (prefix text, next_number integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current integer;
  v_max_existing bigint;
begin
  if public.current_member_role(p_organization_id) is null
     or public.current_member_role(p_organization_id) not in ('owner', 'administratie') then
    raise exception 'not allowed to change work order numbering settings'
      using errcode = '42501';
  end if;

  if p_prefix is null or p_prefix !~ '^[A-Z0-9._/-]{1,10}$' then
    raise exception 'prefix must be 1-10 characters: uppercase letters, digits or - _ . /'
      using errcode = '23514';
  end if;
  if p_next_number is null or p_next_number < 1 or p_next_number > 2000000000 then
    raise exception 'next_number must be a positive integer'
      using errcode = '23514';
  end if;

  insert into public.work_order_number_sequences (organization_id)
  values (p_organization_id)
  on conflict (organization_id) do nothing;

  select s.next_number into v_current
  from public.work_order_number_sequences s
  where s.organization_id = p_organization_id
  for update;

  if p_next_number < v_current then
    raise exception 'next_number can only be raised (current: %)', v_current
      using errcode = '23514';
  end if;

  -- Must stay above every existing number issued with the target prefix
  -- (literal prefix match, then a purely numeric remainder).
  select max(substr(w.work_order_number, length(p_prefix) + 1)::bigint) into v_max_existing
  from public.work_orders w
  where w.organization_id = p_organization_id
    and left(w.work_order_number, length(p_prefix)) = p_prefix
    and substr(w.work_order_number, length(p_prefix) + 1) ~ '^[0-9]{1,15}$';

  if v_max_existing is not null and p_next_number <= v_max_existing then
    raise exception 'next_number must be greater than the highest existing number for prefix % (%)',
      p_prefix, v_max_existing
      using errcode = '23514';
  end if;

  update public.work_order_number_sequences s
  set prefix = p_prefix, next_number = p_next_number
  where s.organization_id = p_organization_id;

  return query select p_prefix, p_next_number;
end;
$$;

comment on function public.update_work_order_numbering_settings(uuid, text, integer) is
  'Sets the org''s work order number prefix (1-10 chars: A-Z, 0-9, - _ . /) and next number. owner/administratie only (42501). Rejects (23514) an invalid prefix, a next_number lower than the current one, or one that is not greater than the highest existing number with the target prefix. Never renumbers existing work orders. Row-locks the sequence so it is race-safe against concurrent inserts.';

revoke all on function public.get_work_order_numbering_settings(uuid) from public;
revoke all on function public.update_work_order_numbering_settings(uuid, text, integer) from public;
grant execute on function public.get_work_order_numbering_settings(uuid) to authenticated;
grant execute on function public.update_work_order_numbering_settings(uuid, text, integer) to authenticated;
