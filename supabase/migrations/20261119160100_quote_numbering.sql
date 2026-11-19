-- quote numbering (issue #228). Mirrors work order numbering
-- (20261117100000_work_order_numbering.sql): per-org sequence/settings table
-- (RLS forced, no policies, no grants), BEFORE INSERT trigger that always
-- overwrites quote_number from the sequence under FOR UPDATE, BEFORE UPDATE trigger
-- rejecting changes, SECURITY DEFINER get_/update_ settings functions
-- (owner/administratie only), backfill per org by (created_at, id) from 100.
-- Trigger name sorts after quotes_derive_organization_id so organization_id is final.
-- Rows inserted by DB triggers (e.g. work order auto-draft quotes) are numbered too.

create table public.quote_number_sequences (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  prefix text not null default 'Q',
  next_number integer not null default 100,
  updated_at timestamptz not null default now(),
  constraint quote_number_sequences_prefix_format check (prefix ~ '^[A-Z0-9._/-]{1,10}$'),
  constraint quote_number_sequences_next_number_range check (next_number between 1 and 2000000000)
);

comment on table public.quote_number_sequences is
  'Per-organization quote numbering settings + counter (issue #228): prefix (1-10 chars: A-Z, 0-9, - _ . /, default Q) and next_number (default 100). RLS enabled/forced with no policies and no grants: read/written only through get_quote_numbering_settings(), update_quote_numbering_settings() and the quotes_set_quote_number trigger (all SECURITY DEFINER).';

alter table public.quote_number_sequences enable row level security;
alter table public.quote_number_sequences force row level security;
revoke all on public.quote_number_sequences from authenticated, anon;

create trigger quote_number_sequences_set_updated_at
  before update on public.quote_number_sequences
  for each row execute function public.set_updated_at();

alter table public.quotes add column quote_number text;

comment on column public.quotes.quote_number is
  'System-assigned per-tenant quote number, <prefix><next_number> (e.g. Q100), minted by the quotes_set_quote_number BEFORE INSERT trigger from quote_number_sequences. Not client-writable (no column grant; UPDATE trigger rejects changes) and immutable. Unique per organization.';

with numbered as (
  select t.id,
         99 + row_number() over (partition by t.organization_id order by t.created_at, t.id) as n
  from public.quotes t
)
update public.quotes t
set quote_number = 'Q' || numbered.n::text
from numbered
where numbered.id = t.id;

insert into public.quote_number_sequences (organization_id, prefix, next_number)
select o.id, 'Q', 100 + coalesce(count(t.id), 0)
from public.organizations o
left join public.quotes t on t.organization_id = o.id
group by o.id;

alter table public.quotes alter column quote_number set not null;
alter table public.quotes
  add constraint quotes_organization_id_quote_number_key unique (organization_id, quote_number);

create or replace function public.assign_quote_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_next integer;
begin
  insert into public.quote_number_sequences (organization_id)
  values (new.organization_id)
  on conflict (organization_id) do nothing;

  select s.prefix, s.next_number into v_prefix, v_next
  from public.quote_number_sequences s
  where s.organization_id = new.organization_id
  for update;

  while exists (
    select 1 from public.quotes t
    where t.organization_id = new.organization_id
      and t.quote_number = v_prefix || v_next::text
  ) loop
    v_next := v_next + 1;
  end loop;

  new.quote_number := v_prefix || v_next::text;

  update public.quote_number_sequences s
  set next_number = v_next + 1
  where s.organization_id = new.organization_id;

  return new;
end;
$$;

comment on function public.assign_quote_number() is
  'BEFORE INSERT trigger on public.quotes: always overwrites quote_number with <prefix><next_number> from the org''s quote_number_sequences row (locked FOR UPDATE, so concurrent inserts in the same org serialize and never duplicate), then increments next_number. Sorts after quotes_derive_organization_id so organization_id is final.';

revoke all on function public.assign_quote_number() from public;
revoke execute on function public.assign_quote_number() from anon;

create trigger quotes_set_quote_number
  before insert on public.quotes
  for each row execute function public.assign_quote_number();

create or replace function public.prevent_quote_number_change()
returns trigger
language plpgsql
as $$
begin
  if new.quote_number is distinct from old.quote_number then
    raise exception 'quotes.quote_number is immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.prevent_quote_number_change() is
  'BEFORE UPDATE OF quote_number trigger on public.quotes: quote numbers are immutable once assigned (also blocks privileged roles).';

create trigger quotes_prevent_quote_number_change
  before update of quote_number on public.quotes
  for each row execute function public.prevent_quote_number_change();

create or replace function public.get_quote_numbering_settings(p_organization_id uuid)
returns table (prefix text, next_number integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_member_role(p_organization_id) is null
     or public.current_member_role(p_organization_id) not in ('owner', 'administratie') then
    raise exception 'not allowed to read quote numbering settings'
      using errcode = '42501';
  end if;

  return query
  select s.prefix, s.next_number
  from public.quote_number_sequences s
  where s.organization_id = p_organization_id;

  if not found then
    return query select 'Q'::text, 100;
  end if;
end;
$$;

comment on function public.get_quote_numbering_settings(uuid) is
  'Returns (prefix, next_number) for the organization; defaults (Q, 100) when no row exists yet. owner/administratie only (42501 otherwise).';

create or replace function public.update_quote_numbering_settings(
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
    raise exception 'not allowed to change quote numbering settings'
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

  insert into public.quote_number_sequences (organization_id)
  values (p_organization_id)
  on conflict (organization_id) do nothing;

  select s.next_number into v_current
  from public.quote_number_sequences s
  where s.organization_id = p_organization_id
  for update;

  if p_next_number < v_current then
    raise exception 'next_number can only be raised (current: %)', v_current
      using errcode = '23514';
  end if;

  select max(substr(t.quote_number, length(p_prefix) + 1)::bigint) into v_max_existing
  from public.quotes t
  where t.organization_id = p_organization_id
    and left(t.quote_number, length(p_prefix)) = p_prefix
    and substr(t.quote_number, length(p_prefix) + 1) ~ '^[0-9]{1,15}$';

  if v_max_existing is not null and p_next_number <= v_max_existing then
    raise exception 'next_number must be greater than the highest existing number for prefix % (%)',
      p_prefix, v_max_existing
      using errcode = '23514';
  end if;

  update public.quote_number_sequences s
  set prefix = p_prefix, next_number = p_next_number
  where s.organization_id = p_organization_id;

  return query select p_prefix, p_next_number;
end;
$$;

comment on function public.update_quote_numbering_settings(uuid, text, integer) is
  'Sets the org''s quote number prefix (1-10 chars: A-Z, 0-9, - _ . /) and next number. owner/administratie only (42501). Rejects (23514) an invalid prefix, a next_number lower than the current one, or one not greater than the highest existing number with the target prefix. Never renumbers existing rows. Row-locks the sequence so it is race-safe against concurrent inserts.';

revoke all on function public.get_quote_numbering_settings(uuid) from public;
revoke all on function public.update_quote_numbering_settings(uuid, text, integer) from public;
revoke execute on function public.get_quote_numbering_settings(uuid) from anon;
revoke execute on function public.update_quote_numbering_settings(uuid, text, integer) from anon;
grant execute on function public.get_quote_numbering_settings(uuid) to authenticated;
grant execute on function public.update_quote_numbering_settings(uuid, text, integer) to authenticated;
