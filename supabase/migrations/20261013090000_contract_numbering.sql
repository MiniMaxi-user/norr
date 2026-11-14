-- Contract numbering (issue #216).
--
-- Every contract gets a system-assigned, immutable, per-tenant number of the
-- form <prefix><next_number> with no zero padding (CON100, CON2872).
-- `contracts.name` becomes the optional `external_reference`.
--
-- Design notes:
-- 1. `contract_number_sequences` (one row per org: prefix, next_number) is the
--    counter + settings table. RLS is enabled and forced with zero policies and
--    no grants: all access goes through SECURITY DEFINER functions
--    (precedent: asset_id_sequences / invoice_number_sequences).
-- 2. contracts_set_contract_number (BEFORE INSERT) always overwrites
--    new.contract_number from the sequence, locking the org's sequence row
--    (FOR UPDATE), so concurrent inserts in one org are serialized and never
--    duplicate. It sorts after contracts_derive_organization_id, so
--    organization_id is final. contract_number is excluded from the INSERT and
--    UPDATE column grants and a BEFORE UPDATE trigger rejects any change.
-- 3. Settings are read/written via get_contract_numbering_settings() and
--    update_contract_numbering_settings() (owner/administratie only).
--    next_number can only be raised, and must exceed every existing number
--    with the target prefix. Changing the prefix never renumbers contracts.
-- 4. Backfill numbers existing contracts per org by (created_at, id) from 100.

-- ---------------------------------------------------------------------------
-- 1. Sequence/settings table.
-- ---------------------------------------------------------------------------
create table public.contract_number_sequences (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  prefix text not null default 'CON',
  next_number integer not null default 100,
  updated_at timestamptz not null default now(),
  constraint contract_number_sequences_prefix_format check (prefix ~ '^[A-Z0-9]{1,10}$'),
  constraint contract_number_sequences_next_number_range check (next_number between 1 and 2000000000)
);

comment on table public.contract_number_sequences is
  'Per-organization contract numbering settings + counter (issue #216): prefix (1-10 uppercase letters/digits, default CON) and next_number (default 100). The next contract gets prefix || next_number, then next_number is incremented under a row lock. RLS enabled/forced with no policies and no grants: read/written only through get_contract_numbering_settings(), update_contract_numbering_settings() and the contracts_set_contract_number trigger (all SECURITY DEFINER).';
comment on column public.contract_number_sequences.prefix is
  'Prefix for newly issued contract numbers. 1-10 chars, A-Z0-9. Changing it never renumbers existing contracts.';
comment on column public.contract_number_sequences.next_number is
  'The number the next contract will receive (no zero padding). Can only be raised via update_contract_numbering_settings().';

alter table public.contract_number_sequences enable row level security;
alter table public.contract_number_sequences force row level security;
revoke all on public.contract_number_sequences from authenticated, anon;

create trigger contract_number_sequences_set_updated_at
  before update on public.contract_number_sequences
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. contracts: rename name -> external_reference (nullable), add contract_number.
-- ---------------------------------------------------------------------------
alter table public.contracts rename column name to external_reference;
alter table public.contracts alter column external_reference drop not null;

comment on column public.contracts.external_reference is
  'Optional free-text external reference (e.g. the customer''s own contract/PO number or a description), shown on invoices to the recipient. Formerly contracts.name; the contract_number is now the primary identifier.';

alter table public.contracts add column contract_number text;

comment on column public.contracts.contract_number is
  'System-assigned per-tenant contract number, <prefix><next_number> (e.g. CON100), minted by the contracts_set_contract_number BEFORE INSERT trigger from contract_number_sequences. Not client-writable (excluded from INSERT/UPDATE grants; UPDATE trigger rejects changes) and immutable. Unique per organization.';

-- ---------------------------------------------------------------------------
-- 3. Backfill existing contracts, then the sequences.
-- ---------------------------------------------------------------------------
with numbered as (
  select c.id,
         99 + row_number() over (partition by c.organization_id order by c.created_at, c.id) as n
  from public.contracts c
)
update public.contracts c
set contract_number = 'CON' || numbered.n::text
from numbered
where numbered.id = c.id;

insert into public.contract_number_sequences (organization_id, prefix, next_number)
select o.id, 'CON', 100 + coalesce(count(c.id), 0)
from public.organizations o
left join public.contracts c on c.organization_id = o.id
group by o.id;

alter table public.contracts alter column contract_number set not null;
alter table public.contracts
  add constraint contracts_organization_id_contract_number_key unique (organization_id, contract_number);

-- ---------------------------------------------------------------------------
-- 4. Trigger: assign number on insert, forbid changes on update.
-- ---------------------------------------------------------------------------
create or replace function public.assign_contract_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_next integer;
begin
  insert into public.contract_number_sequences (organization_id)
  values (new.organization_id)
  on conflict (organization_id) do nothing;

  select s.prefix, s.next_number into v_prefix, v_next
  from public.contract_number_sequences s
  where s.organization_id = new.organization_id
  for update;

  -- Defensive: skip numbers that already exist (cannot normally happen, the
  -- settings function guards against it).
  while exists (
    select 1 from public.contracts c
    where c.organization_id = new.organization_id
      and c.contract_number = v_prefix || v_next::text
  ) loop
    v_next := v_next + 1;
  end loop;

  new.contract_number := v_prefix || v_next::text;

  update public.contract_number_sequences s
  set next_number = v_next + 1
  where s.organization_id = new.organization_id;

  return new;
end;
$$;

comment on function public.assign_contract_number() is
  'BEFORE INSERT trigger on public.contracts: always overwrites contract_number with <prefix><next_number> from the org''s contract_number_sequences row (locked FOR UPDATE, so concurrent inserts in the same org serialize and never duplicate), then increments next_number. Sorts after contracts_derive_organization_id so organization_id is final.';

revoke all on function public.assign_contract_number() from public;

create trigger contracts_set_contract_number
  before insert on public.contracts
  for each row execute function public.assign_contract_number();

create or replace function public.prevent_contract_number_change()
returns trigger
language plpgsql
as $$
begin
  if new.contract_number is distinct from old.contract_number then
    raise exception 'contracts.contract_number is immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.prevent_contract_number_change() is
  'BEFORE UPDATE OF contract_number trigger on public.contracts: contract numbers are immutable once assigned (also blocks privileged roles).';

create trigger contracts_prevent_contract_number_change
  before update of contract_number on public.contracts
  for each row execute function public.prevent_contract_number_change();

-- ---------------------------------------------------------------------------
-- 5. Settings API (owner/administratie only).
-- ---------------------------------------------------------------------------
create or replace function public.get_contract_numbering_settings(p_organization_id uuid)
returns table (prefix text, next_number integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_member_role(p_organization_id) is null
     or public.current_member_role(p_organization_id) not in ('owner', 'administratie') then
    raise exception 'not allowed to read contract numbering settings'
      using errcode = '42501';
  end if;

  return query
  select s.prefix, s.next_number
  from public.contract_number_sequences s
  where s.organization_id = p_organization_id;

  if not found then
    return query select 'CON'::text, 100;
  end if;
end;
$$;

comment on function public.get_contract_numbering_settings(uuid) is
  'Returns (prefix, next_number) for the organization; defaults (CON, 100) when no row exists yet. owner/administratie only (42501 otherwise).';

create or replace function public.update_contract_numbering_settings(
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
    raise exception 'not allowed to change contract numbering settings'
      using errcode = '42501';
  end if;

  if p_prefix is null or p_prefix !~ '^[A-Z0-9]{1,10}$' then
    raise exception 'prefix must be 1-10 uppercase letters or digits'
      using errcode = '23514';
  end if;
  if p_next_number is null or p_next_number < 1 or p_next_number > 2000000000 then
    raise exception 'next_number must be a positive integer'
      using errcode = '23514';
  end if;

  insert into public.contract_number_sequences (organization_id)
  values (p_organization_id)
  on conflict (organization_id) do nothing;

  select s.next_number into v_current
  from public.contract_number_sequences s
  where s.organization_id = p_organization_id
  for update;

  if p_next_number < v_current then
    raise exception 'next_number can only be raised (current: %)', v_current
      using errcode = '23514';
  end if;

  -- Must stay above every existing number issued with the target prefix.
  select max(substr(c.contract_number, length(p_prefix) + 1)::bigint) into v_max_existing
  from public.contracts c
  where c.organization_id = p_organization_id
    and c.contract_number ~ ('^' || p_prefix || '[0-9]{1,15}$');

  if v_max_existing is not null and p_next_number <= v_max_existing then
    raise exception 'next_number must be greater than the highest existing number for prefix % (%)',
      p_prefix, v_max_existing
      using errcode = '23514';
  end if;

  update public.contract_number_sequences s
  set prefix = p_prefix, next_number = p_next_number
  where s.organization_id = p_organization_id;

  return query select p_prefix, p_next_number;
end;
$$;

comment on function public.update_contract_numbering_settings(uuid, text, integer) is
  'Sets the org''s contract number prefix (1-10 chars A-Z0-9) and next number. owner/administratie only (42501). Rejects (23514) an invalid prefix, a next_number lower than the current one, or one that is not greater than the highest existing number with the target prefix. Never renumbers existing contracts. Row-locks the sequence so it is race-safe against concurrent inserts.';

revoke all on function public.get_contract_numbering_settings(uuid) from public;
revoke all on function public.update_contract_numbering_settings(uuid, text, integer) from public;
grant execute on function public.get_contract_numbering_settings(uuid) to authenticated;
grant execute on function public.update_contract_numbering_settings(uuid, text, integer) to authenticated;
