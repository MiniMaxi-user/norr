-- Issue #271 QA follow-up: race guard in complete_contract_end(). Body copied
-- forward from 20261124090000; the only change is the guard after the date
-- check: refuse (23514) when the contract has an un-invoiced period quote
-- starting on or before the end date, or an un-invoiced counter settlement
-- quote overlapping the windows being settled, that is not in
-- p_delete_quote_ids (quotes created after the balance was computed).

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
begin
  select * into v_contract from public.contracts where id = p_contract_id for update;
  if not found then
    raise exception 'Contract not found.' using errcode = 'P0002';
  end if;

  if auth.uid() is null
     or coalesce(public.current_member_role(v_contract.organization_id) not in ('owner', 'finance'), true) then
    raise exception 'Only an owner or finance member can end a contract.' using errcode = '42501';
  end if;

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
  'Issue #271: atomically completes a contract''s final balance (see 20261124090000) plus a race guard (20261124100000): 23514 "New contract quotes were created meanwhile; reload the final balance." when an un-invoiced period quote with contract_period_start <= p_end_date, or an un-invoiced counter settlement quote overlapping the settled windows, is not in p_delete_quote_ids. Owner/finance only (42501).';

revoke all on function public.complete_contract_end(uuid, date, jsonb, jsonb, jsonb, jsonb, uuid[]) from public, anon;
grant execute on function public.complete_contract_end(uuid, date, jsonb, jsonb, jsonb, jsonb, uuid[]) to authenticated;
