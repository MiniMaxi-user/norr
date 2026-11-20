-- Issues #269 (contract invoicing in advance / in arrears with counter
-- overage settlement) and #270 (contract status Draft / Active / Ended with
-- required counter baseline readings). Schema + guards only; generation and
-- settlement logic live in the application layer.
--
-- Design notes:
--
-- 1. contracts.status ('draft' | 'active' | 'ended', fixed system enum as a
--    text check). The column is added with default 'active' so every
--    EXISTING contract becomes Active (and the activation trigger, created
--    afterwards, does not run for the backfill); the default is then
--    switched to 'draft' for new rows.
-- 2. contracts.invoicing_timing ('in_advance' | 'in_arrears'), default
--    'in_advance' (= current behaviour, also for existing contracts).
-- 3. Both columns are insertable/updatable by the roles that edit contracts
--    (the existing column-level grant pattern, RLS unchanged).
-- 4. contract_covered_assets(contract) walks contract_assets + all
--    asset_components descendants and exposes coverage_start per asset: the
--    contract start date, or for an asset linked to a NON-draft contract
--    later, the date it was added (contract_assets.added_on, UTC date). A
--    component inherits the start of the covered ancestor it hangs under.
--    DEVIATION from the story text: contract_assets already has created_at,
--    but that is a link timestamp, not the baseline date, and assets linked
--    while the contract is still Draft must follow later edits of the start
--    date. So added_on is NULLABLE: null = "covered from the contract start
--    date" (every existing row, and rows linked while Draft); set to today
--    (UTC) by trigger when linking to a non-draft contract. Not
--    client-writable.
-- 5. contract_missing_baseline_readings(contract) (security invoker, stable):
--    every covered asset whose model has a counter that is the volume_item_id
--    of one of the contract's is_volume lines and that has no accepted
--    (needs_review = false) reading on or before the end of the start date
--    day (UTC, 23:59:59.999, like the app). A BEFORE INSERT OR UPDATE OF
--    status trigger refuses a change to 'active' (draft -> active, ended ->
--    active, or insert as active) while it returns rows (23514, message
--    'Missing baseline readings: asset – counter, ...'), and refuses
--    ended -> active after the end date.
-- 6. quotes gets counter_settlement_start/_end (the counter period whose
--    overage the quote settles; both or neither; unique per contract so a
--    period is never settled twice) and is_final_settlement (the extra quote
--    after the end date carrying only the last period's overage). The final
--    settlement quote is excluded from the per-period unique index and gets
--    its own (one per contract). advance_contract_on_invoice() and
--    credit_invoice() never touch invoiced_period_count for it (bodies
--    copied forward from the live versions 20261010100000 / 20261121100000).
--    The app should give a final settlement quote contract_period_start =
--    end_date + 1 so credit_invoice()'s "latest period" rule keeps working.
-- 7. Coverage: is_article_covered_by_contract() (the single SQL place that
--    resolves contract coverage; the auto-draft quote sync triggers and
--    contract_covered_article_ids() go through it) now requires an Active
--    contract.

-- ---------------------------------------------------------------------------
-- contracts: status + invoicing_timing
-- ---------------------------------------------------------------------------
alter table public.contracts
  add column status text not null default 'active',
  add column invoicing_timing text not null default 'in_advance',
  add constraint contracts_status_check check (status in ('draft', 'active', 'ended')),
  add constraint contracts_invoicing_timing_check check (invoicing_timing in ('in_advance', 'in_arrears'));

alter table public.contracts alter column status set default 'draft';

comment on column public.contracts.status is
  'draft | active | ended (issue #270). New contracts start as draft; existing ones were backfilled to active. Only active contracts are invoiced and give work order coverage (ended ones still get a final counter settlement). Becoming active requires every counter baseline reading (guard_contract_status_change).';
comment on column public.contracts.invoicing_timing is
  'in_advance (default) | in_arrears (issue #269): whether a period is invoiced from its start or after it has ended. Drives where the counter overage of a period is settled.';

create index contracts_org_status_idx on public.contracts (organization_id, status);

grant insert (status, invoicing_timing) on public.contracts to authenticated;
grant update (status, invoicing_timing) on public.contracts to authenticated;

-- ---------------------------------------------------------------------------
-- contract_assets.added_on
-- ---------------------------------------------------------------------------
alter table public.contract_assets add column added_on date;

comment on column public.contract_assets.added_on is
  'Date (UTC) the asset was added to an already non-draft contract; the settlement baseline for that asset. NULL = covered from the contract start date (rows linked while the contract was Draft, and all rows that existed before #269). Set by contract_assets_set_added_on; not client-writable.';

create or replace function public.set_contract_asset_added_on()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select c.status into v_status from public.contracts c where c.id = new.contract_id;
  new.added_on := case
    when v_status is distinct from 'draft' then (now() at time zone 'UTC')::date
    else null
  end;
  return new;
end;
$$;

comment on function public.set_contract_asset_added_on() is
  'BEFORE INSERT trigger on public.contract_assets (issue #269): added_on = today (UTC) when the contract is not Draft, else NULL (covered from the contract start date).';

revoke all on function public.set_contract_asset_added_on() from public, anon, authenticated;

create trigger contract_assets_set_added_on
  before insert on public.contract_assets
  for each row execute function public.set_contract_asset_added_on();

-- ---------------------------------------------------------------------------
-- Coverage walk + coverage start
-- ---------------------------------------------------------------------------
create or replace function public.contract_covered_assets(p_contract_id uuid)
returns table (asset_id uuid, root_asset_id uuid, coverage_start date)
language sql
stable
security invoker
set search_path = public
as $$
  with recursive cov(asset_id, root_asset_id, coverage_start) as (
    select ca.asset_id, ca.asset_id,
           greatest(k.start_date, coalesce(ca.added_on, k.start_date))
      from public.contract_assets ca
      join public.contracts k on k.id = ca.contract_id
      where ca.contract_id = p_contract_id
    union all
    select ac.component_asset_id, cov.root_asset_id, cov.coverage_start
      from public.asset_components ac
      join cov on ac.parent_asset_id = cov.asset_id
  )
  select distinct on (cov.asset_id) cov.asset_id, cov.root_asset_id, cov.coverage_start
    from cov
    order by cov.asset_id, cov.coverage_start;
$$;

comment on function public.contract_covered_assets(uuid) is
  'Issue #269/#270: every asset covered by the contract (direct contract_assets plus all asset_components descendants) with the covered root asset it hangs under and its coverage_start (contract start date, or the date the root was added to a non-draft contract; components inherit their ancestor''s). One row per asset (earliest start wins). SECURITY INVOKER, stable.';

revoke all on function public.contract_covered_assets(uuid) from public, anon;
grant execute on function public.contract_covered_assets(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Missing baseline readings
-- ---------------------------------------------------------------------------
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
    from (select distinct cv.asset_id from public.contract_covered_assets(p_contract_id) cv) cov
    join public.assets a on a.id = cov.asset_id
    join public.asset_model_volumes amv on amv.asset_model_id = a.model_id
    join public.reference_list_items rli on rli.id = amv.volume_item_id
    where exists (
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
  'Issue #270 internal variant of contract_missing_baseline_readings taking the start date explicitly (the activation trigger must use the NEW start_date). Day boundary is UTC (end of the start date, 23:59:59.999Z), like the app. SECURITY INVOKER, stable.';

create or replace function public.contract_missing_baseline_readings(p_contract_id uuid)
returns table (asset_id uuid, asset_name text, volume_item_id uuid, counter_label text)
language sql
stable
security invoker
set search_path = public
as $$
  select m.asset_id, m.asset_name, m.volume_item_id, m.counter_label
    from public.contracts k
    cross join lateral public.contract_missing_baseline_readings_at(k.id, k.start_date) m
    where k.id = p_contract_id;
$$;

comment on function public.contract_missing_baseline_readings(uuid) is
  'Issue #270: for every covered asset (direct + components) and every counter of the contract''s volume lines that the asset''s model has, a row when no accepted (needs_review = false) reading exists on or before the end of the contract start date (UTC). Empty when nothing is missing, the contract is unknown, or it belongs to another organization (RLS). SECURITY INVOKER, stable.';

revoke all on function public.contract_missing_baseline_readings_at(uuid, date) from public, anon;
grant execute on function public.contract_missing_baseline_readings_at(uuid, date) to authenticated;
revoke all on function public.contract_missing_baseline_readings(uuid) from public, anon;
grant execute on function public.contract_missing_baseline_readings(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Activation guard
-- ---------------------------------------------------------------------------
create or replace function public.guard_contract_status_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_missing text;
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    if tg_op = 'UPDATE' and old.status = 'ended'
       and new.end_date is not null
       and new.end_date < (now() at time zone 'UTC')::date then
      raise exception 'An ended contract cannot be reactivated after its end date'
        using errcode = '23514';
    end if;

    select string_agg(m.asset_name || ' – ' || m.counter_label, ', ' order by m.asset_name, m.counter_label)
      into v_missing
      from public.contract_missing_baseline_readings_at(new.id, new.start_date) m;

    if v_missing is not null then
      raise exception 'Missing baseline readings: %', v_missing
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.guard_contract_status_change() is
  'BEFORE INSERT OR UPDATE OF status trigger on public.contracts (issue #270): a contract can only become active (from draft or ended, or inserted as active) when contract_missing_baseline_readings returns nothing (23514, message starts with ''Missing baseline readings:'' followed by ''asset – counter'' items joined by '', ''); ended -> active is also refused once end_date has passed. SECURITY INVOKER: runs with the caller''s RLS, like the guard function it uses.';

revoke all on function public.guard_contract_status_change() from public, anon, authenticated;

create trigger contracts_guard_status_change
  before insert or update of status on public.contracts
  for each row execute function public.guard_contract_status_change();

-- ---------------------------------------------------------------------------
-- quotes: counter settlement + final settlement
-- ---------------------------------------------------------------------------
alter table public.quotes
  add column counter_settlement_start date,
  add column counter_settlement_end date,
  add column is_final_settlement boolean not null default false,
  add constraint quotes_counter_settlement_both_or_neither
    check ((counter_settlement_start is null) = (counter_settlement_end is null)),
  add constraint quotes_counter_settlement_order
    check (counter_settlement_start is null or counter_settlement_end >= counter_settlement_start),
  add constraint quotes_counter_settlement_only_contract_type
    check (counter_settlement_start is null or quote_type = 'contract'),
  add constraint quotes_final_settlement_requires_settlement
    check (not is_final_settlement or (quote_type = 'contract' and counter_settlement_start is not null));

comment on column public.quotes.counter_settlement_start is
  'First day of the counter period whose overage is settled on this contract quote (issue #269); with counter_settlement_end both set or both null. Insert-only.';
comment on column public.quotes.counter_settlement_end is
  'Last day of the counter period whose overage is settled on this contract quote (issue #269). Insert-only.';
comment on column public.quotes.is_final_settlement is
  'True for the extra contract quote created after the end date that carries only the last period''s counter overage (issue #269). Does not count as an invoiced period: advance_contract_on_invoice()/credit_invoice() leave contracts.invoiced_period_count alone. At most one per contract. Insert-only.';

drop index public.quotes_one_contract_quote_per_period_idx;
create unique index quotes_one_contract_quote_per_period_idx
  on public.quotes (contract_id, contract_period_start)
  where quote_type = 'contract' and contract_id is not null and not is_final_settlement;

create unique index quotes_one_final_settlement_per_contract_idx
  on public.quotes (contract_id)
  where is_final_settlement and contract_id is not null;

create unique index quotes_one_counter_settlement_per_period_idx
  on public.quotes (contract_id, counter_settlement_start)
  where counter_settlement_start is not null and contract_id is not null;

grant insert (counter_settlement_start, counter_settlement_end, is_final_settlement)
  on public.quotes to authenticated;

-- ---------------------------------------------------------------------------
-- advance_contract_on_invoice(): body copied from 20261010100000 (the live
-- version; 20261121090000 only changed the trigger's WHEN clause), plus: a
-- final settlement quote is not a period.
-- ---------------------------------------------------------------------------
create or replace function public.advance_contract_on_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract_id uuid;
  v_type public.quote_type;
  v_final boolean;
begin
  select q.contract_id, q.quote_type, q.is_final_settlement into v_contract_id, v_type, v_final
  from public.quotes q
  where q.id = new.quote_id;

  if v_type = 'contract' and v_contract_id is not null and not v_final then
    update public.contracts
    set invoiced_period_count = invoiced_period_count + 1
    where id = v_contract_id;
  end if;

  return null;
end;
$$;

comment on function public.advance_contract_on_invoice() is
  'AFTER INSERT trigger on public.invoices (issue #211), only for kind = ''invoice'': increments contracts.invoiced_period_count for an invoiced contract quote (not for a final settlement quote, since 20261123120000); contracts_compute_next_invoice_date then advances next_invoice_date. credit_invoice() decrements it again.';

-- ---------------------------------------------------------------------------
-- Coverage: only Active contracts. Body copied from
-- 20260921090000_work_order_price_respects_contract_article_coverage.sql
-- (no later redefinition) plus the status check.
-- ---------------------------------------------------------------------------
create or replace function public.is_article_covered_by_contract(
  p_contract_id uuid,
  p_article_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  with recursive grp(id) as (
    select a.group_id from public.articles a
      where a.id = p_article_id and a.group_id is not null
    union
    select g.parent_group_id from public.article_groups g
      join grp on g.id = grp.id
      where g.parent_group_id is not null
  ),
  matched as (
    select r.is_excluded
      from public.contract_article_rules r
      where r.contract_id = p_contract_id and r.article_id = p_article_id
    union all
    select gr.is_excluded
      from public.contract_article_group_rules gr
      where gr.contract_id = p_contract_id
        and gr.article_group_id in (select id from grp)
  )
  select p_contract_id is not null
    and p_article_id is not null
    and exists (select 1 from public.contracts c where c.id = p_contract_id and c.status = 'active')
    and exists (select 1 from matched where is_excluded)
    and not exists (select 1 from matched where not is_excluded);
$$;

comment on function public.is_article_covered_by_contract(uuid, uuid) is
  'Issue #208/#270: true when the contract is ACTIVE and covers the article (sale price 0 on work order quotes). Collects the article rule + group rules on its group and all ancestor groups; any rule with is_excluded=false (UI "Excluded") overrules everything (not covered); else any is_excluded=true (UI "Included") => covered; else false. Null, draft or ended contract => false. SECURITY INVOKER, stable.';

-- ---------------------------------------------------------------------------
-- credit_invoice(): body copied verbatim from 20261121100000 (the live
-- version), with ONE change in two places: a final settlement quote is not a
-- period, so it neither takes part in the "latest period" check nor rolls
-- invoiced_period_count back.
-- ---------------------------------------------------------------------------
create or replace function public.credit_invoice(p_invoice_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote_id uuid;
  v_quote public.quotes%rowtype;
  v_orig public.invoices%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_number text;
  v_today date := (now() at time zone 'Europe/Amsterdam')::date;
  v_credit_id uuid;
  v_breakdown jsonb;
  v_status_id uuid;
  v_completed_id uuid;
begin
  -- Lock order matches create_invoice(): quote first, then invoice.
  select i.quote_id into v_quote_id from public.invoices i where i.id = p_invoice_id;
  if not found then
    raise exception 'Invoice not found, or you do not have permission to view it.' using errcode = 'P0002';
  end if;

  select * into v_quote from public.quotes where id = v_quote_id for update;
  select * into v_orig from public.invoices where id = p_invoice_id for update;

  if not public.is_invoicing_member(v_orig.organization_id) then
    raise exception 'Only an owner, finance or administratie member can credit invoices.' using errcode = '42501';
  end if;
  if v_orig.kind <> 'invoice' then
    raise exception 'A credit note cannot be credited.' using errcode = '23514';
  end if;
  if v_orig.credited_at is not null then
    raise exception 'This invoice has already been credited.' using errcode = '23505';
  end if;
  if v_reason = '' then
    raise exception 'A reason is required.' using errcode = '23514';
  end if;

  -- Contract quote: only the contract's latest invoiced period can be
  -- credited. Rolling back invoiced_period_count by one for an earlier
  -- period would point next_invoice_date at a period that is still invoiced.
  if v_quote.quote_type = 'contract' and v_quote.contract_id is not null
    and not v_quote.is_final_settlement and exists (
    select 1
    from public.invoices i
    join public.quotes q on q.id = i.quote_id
    where q.contract_id = v_quote.contract_id
      and q.quote_type = 'contract'
      and q.id <> v_quote.id
      and i.kind = 'invoice'
      and i.credited_at is null
      and q.contract_period_start > v_quote.contract_period_start
  ) then
    raise exception 'Only the latest invoiced period of a contract can be credited. Credit the later periods first.'
      using errcode = '23514';
  end if;

  v_number := public.next_invoice_number(v_orig.organization_id);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'vat_percent', e.item -> 'vat_percent',
        'base', -((e.item ->> 'base')::numeric),
        'amount', -((e.item ->> 'amount')::numeric)
      ) order by e.ord
    ),
    '[]'::jsonb
  )
  into v_breakdown
  from jsonb_array_elements(v_orig.vat_breakdown) with ordinality as e(item, ord);

  insert into public.invoices (
    quote_id, invoice_number, kind, credits_invoice_id, credit_reason,
    invoice_date, due_date, payment_term_days, currency,
    subtotal, vat_total, total, vat_breakdown,
    reference, work_order_reference, notes, recipient, sender
  )
  values (
    v_orig.quote_id, v_number, 'credit_note', v_orig.id, v_reason,
    v_today, v_today, 0, v_orig.currency,
    -v_orig.subtotal, -v_orig.vat_total, -v_orig.total, v_breakdown,
    v_orig.reference, v_orig.work_order_reference, v_orig.notes, v_orig.recipient, v_orig.sender
  )
  returning id into v_credit_id;

  insert into public.invoice_lines (
    organization_id, invoice_id, sort_order, article_number, description, asset_label,
    quantity, unit_price, discount_percent, vat_percent, line_total
  )
  select
    l.organization_id, v_credit_id, l.sort_order, l.article_number, l.description, l.asset_label,
    -l.quantity, l.unit_price, l.discount_percent, l.vat_percent, -l.line_total
  from public.invoice_lines l
  where l.invoice_id = v_orig.id;

  update public.invoices set credited_at = now() where id = v_orig.id;

  -- Quote: back to Accepted (not in the default list since 20261011090000,
  -- tenants may have re-added it), else Draft, else the list default.
  select rli.id into v_status_id
  from public.reference_list_items rli
  join public.reference_lists rl on rl.id = rli.reference_list_id
  where rl.organization_id = v_orig.organization_id
    and rl.list_key = 'quote_status'
    and rli.value in ('accepted', 'draft')
  order by (rli.value = 'accepted') desc
  limit 1;
  if v_status_id is null then
    select rli.id into v_status_id
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rl.organization_id = v_orig.organization_id
      and rl.list_key = 'quote_status'
      and rli.is_default
    limit 1;
  end if;
  if v_status_id is not null then
    update public.quotes set status_id = v_status_id where id = v_orig.quote_id;
  end if;

  -- Work order: Invoiced -> Completed.
  if v_quote.work_order_id is not null then
    select rli.id into v_completed_id
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rl.organization_id = v_orig.organization_id
      and rl.list_key = 'work_order_status'
      and rli.value = 'completed'
    limit 1;
    if v_completed_id is not null then
      update public.work_orders wo
      set status_id = v_completed_id
      from public.reference_list_items cur
      where wo.id = v_quote.work_order_id
        and cur.id = wo.status_id
        and cur.value = 'invoiced';
    end if;
  end if;

  -- Contract quote: roll the invoiced period back; the BEFORE UPDATE trigger
  -- contracts_compute_next_invoice_date recomputes next_invoice_date.
  if v_quote.quote_type = 'contract' and v_quote.contract_id is not null
    and not v_quote.is_final_settlement then
    update public.contracts
    set invoiced_period_count = greatest(invoiced_period_count - 1, 0)
    where id = v_quote.contract_id;
  end if;

  return v_credit_id;
end;
$$;

comment on function public.credit_invoice(uuid, text) is
  'Credits an invoice (issue #236): creates a credit note in the same number series (negated snapshot and lines, due today, term 0), sets invoices.credited_at on the original, moves the quote back to accepted (else draft), an Invoiced work order back to Completed and rolls a contract quote''s invoiced_period_count back by one (only for the contract''s latest invoiced period, else 23514; since 20261121100000; a final settlement quote is exempt from that rule and never changes the period count, since 20261123120000). owner/finance/administratie only (42501); P0002 not found; 23514 for a credit note or a blank reason; 23505 when already credited. Payments on the original stay as history. Returns the credit note id.';

revoke all on function public.credit_invoice(uuid, text) from public;
revoke all on function public.credit_invoice(uuid, text) from anon;
grant execute on function public.credit_invoice(uuid, text) to authenticated;
