-- Contract numbering: allow separator characters in the prefix (follow-up to #216).
-- Prefix may now contain A-Z, 0-9 and the separators - _ . / (e.g. CON-, C_2026/).
-- The "highest existing number" lookup no longer interpolates the prefix into a
-- regex (where . would be a wildcard) but compares it literally.

alter table public.contract_number_sequences
  drop constraint contract_number_sequences_prefix_format;
alter table public.contract_number_sequences
  add constraint contract_number_sequences_prefix_format check (prefix ~ '^[A-Z0-9._/-]{1,10}$');

comment on column public.contract_number_sequences.prefix is
  'Prefix for newly issued contract numbers. 1-10 chars: A-Z, 0-9 and - _ . /. Changing it never renumbers existing contracts.';

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

  if p_prefix is null or p_prefix !~ '^[A-Z0-9._/-]{1,10}$' then
    raise exception 'prefix must be 1-10 characters: uppercase letters, digits or - _ . /'
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

  -- Must stay above every existing number issued with the target prefix
  -- (literal prefix match, then a purely numeric remainder).
  select max(substr(c.contract_number, length(p_prefix) + 1)::bigint) into v_max_existing
  from public.contracts c
  where c.organization_id = p_organization_id
    and left(c.contract_number, length(p_prefix)) = p_prefix
    and substr(c.contract_number, length(p_prefix) + 1) ~ '^[0-9]{1,15}$';

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
  'Sets the org''s contract number prefix (1-10 chars: A-Z, 0-9, - _ . /) and next number. owner/administratie only (42501). Rejects (23514) an invalid prefix, a next_number lower than the current one, or one that is not greater than the highest existing number with the target prefix. Never renumbers existing contracts. Row-locks the sequence so it is race-safe against concurrent inserts.';
