-- Issue #271: contract final balance on ending, configurable counter
-- settlement frequency, under-use credit. Builds on #269/#270
-- (20261123120000_contract_status_and_invoicing_timing.sql).
--
-- Design notes:
--
-- 1. contracts.counter_settlement_frequency ('with_invoice' | 'monthly' |
--    'quarterly' | 'annually', default 'with_invoice' = current behaviour,
--    also for existing contracts) and counter_settlement_month (1..12; set
--    exactly for quarterly/annually, null otherwise). end_scheduled_at /
--    end_date_before_scheduling carry a scheduled ending (end date in the
--    future: contract stays active; the previous end_date is restored when the
--    ending is cancelled). All four are in the owner/finance column grants.
-- 2. contract_line_items.credit_under_use (default false = minimum contract,
--    current behaviour): only for a volume line with a counter. A BEFORE
--    UPDATE trigger switches it off when the counter is detached (the
--    volume_item_id ON DELETE SET NULL cascade would otherwise violate the
--    check and block deleting a counter list item).
-- 3. quotes.is_counter_settlement: a periodic counter settlement quote (not a
--    billing period, like the final settlement quote). A final quote may now
--    carry no counter part (quotes_final_settlement_requires_settlement is
--    replaced by quotes_final_settlement_contract_only). The per-period unique
--    index excludes both kinds. advance_contract_on_invoice() and
--    credit_invoice() (LIVE bodies copied forward from 20261123120000) treat
--    counter settlement quotes like final ones; credit_invoice()'s "latest
--    invoiced period" rule ignores final and counter settlement quotes on both
--    sides.
-- 4. contract_counter_settlements: the settlement ledger, the single source of
--    truth for "this window is settled" (one row per settled window, also when
--    nothing was billed, hence quote_id nullable). organization_id derived
--    from the contract. RLS: select for every member (same audience as
--    contracts); insert/delete for owner, planner (batch "Generate contract
--    quotes") and finance (ending a contract). No UPDATE. quote_id is ON
--    DELETE CASCADE: deleting an un-invoiced quote un-settles its windows.
--    Existing quotes with a counter settlement period are backfilled.
-- 5. guard_contract_status_change(): ended -> active is also refused once a
--    final settlement exists (a final settlement quote, or - for a final
--    balance that billed nothing - a final ledger row).
-- 6. complete_contract_end(): SECURITY DEFINER RPC doing the whole ending
--    atomically (closing readings, deleting replaced un-invoiced period
--    quotes, the final settlement quote with lines, final ledger rows, the
--    contract -> ended). Ending a contract is a contracts:update action, so
--    finance (owner/finance only, see the role check) may thereby create the
--    final settlement quote and closing readings, which the table policies
--    would not allow them directly. Amounts are computed by the application;
--    the RPC validates structure, ownership and dates, not prices.

-- ---------------------------------------------------------------------------
-- contracts
-- ---------------------------------------------------------------------------
alter table public.contracts
  add column counter_settlement_frequency text not null default 'with_invoice',
  add column counter_settlement_month smallint,
  add column end_scheduled_at timestamptz,
  add column end_date_before_scheduling date,
  add constraint contracts_counter_settlement_frequency_check
    check (counter_settlement_frequency in ('with_invoice', 'monthly', 'quarterly', 'annually')),
  add constraint contracts_counter_settlement_month_range
    check (counter_settlement_month is null or counter_settlement_month between 1 and 12),
  add constraint contracts_counter_settlement_month_required
    check ((counter_settlement_month is not null) = (counter_settlement_frequency in ('quarterly', 'annually')));

comment on column public.contracts.counter_settlement_frequency is
  'with_invoice (default) | monthly | quarterly | annually (issue #271): when counter overage/under-use is settled. with_invoice = on the period invoice (#269 behaviour); otherwise on separate counter settlement quotes per calendar window.';
comment on column public.contracts.counter_settlement_month is
  'Month (1-12) of the settlement date for quarterly (months congruent mod 3) and annually. Required for those two frequencies, null otherwise (check). The app defaults it to the contract start month.';
comment on column public.contracts.end_scheduled_at is
  'When the user scheduled an ending (end_date in the future, contract still active); null = no scheduled ending. Cleared when the final balance is completed.';
comment on column public.contracts.end_date_before_scheduling is
  'The end_date before the ending was scheduled, restored when the scheduled ending is cancelled. Null when end_date was empty or nothing is scheduled.';

grant insert (counter_settlement_frequency, counter_settlement_month, end_scheduled_at, end_date_before_scheduling)
  on public.contracts to authenticated;
grant update (counter_settlement_frequency, counter_settlement_month, end_scheduled_at, end_date_before_scheduling)
  on public.contracts to authenticated;

-- ---------------------------------------------------------------------------
-- contract_line_items.credit_under_use
-- ---------------------------------------------------------------------------
alter table public.contract_line_items
  add column credit_under_use boolean not null default false,
  add constraint contract_line_items_credit_under_use_requires_counter
    check (not credit_under_use or (is_volume and volume_item_id is not null));

comment on column public.contract_line_items.credit_under_use is
  'Issue #271. false (default) = minimum contract: the included volume is always paid, only overage is billed. true = usage below the included volume (pro rata) is credited at the line''s own unit_price. Only for a volume line with a counter (check).';

create or replace function public.reset_credit_under_use_on_counter_detach()
returns trigger
language plpgsql
as $$
begin
  if new.volume_item_id is null and old.volume_item_id is not null then
    new.credit_under_use := false;
  end if;
  return new;
end;
$$;

comment on function public.reset_credit_under_use_on_counter_detach() is
  'BEFORE UPDATE OF volume_item_id trigger on public.contract_line_items: switches credit_under_use off when the counter is detached (also by the ON DELETE SET NULL cascade), so contract_line_items_credit_under_use_requires_counter never blocks deleting a counter.';

revoke all on function public.reset_credit_under_use_on_counter_detach() from public, anon, authenticated;

create trigger contract_line_items_reset_credit_under_use
  before update of volume_item_id on public.contract_line_items
  for each row execute function public.reset_credit_under_use_on_counter_detach();

grant insert (credit_under_use) on public.contract_line_items to authenticated;
grant update (credit_under_use) on public.contract_line_items to authenticated;

-- ---------------------------------------------------------------------------
-- quotes
-- ---------------------------------------------------------------------------
alter table public.quotes
  add column is_counter_settlement boolean not null default false,
  add constraint quotes_final_xor_counter_settlement
    check (not (is_final_settlement and is_counter_settlement)),
  add constraint quotes_counter_settlement_requires_window
    check (not is_counter_settlement or (quote_type = 'contract' and counter_settlement_start is not null));

alter table public.quotes drop constraint quotes_final_settlement_requires_settlement;
alter table public.quotes
  add constraint quotes_final_settlement_contract_only
    check (not is_final_settlement or quote_type = 'contract');

comment on column public.quotes.is_counter_settlement is
  'True for a periodic counter settlement quote (issue #271, counter_settlement_frequency other than with_invoice). Not a billing period: does not count towards contracts.invoiced_period_count. Mutually exclusive with is_final_settlement; requires counter_settlement_start. Insert-only.';
comment on column public.quotes.is_final_settlement is
  'True for the contract''s final settlement quote (issue #269/#271): open period charges, credit lines and counter settlement created when the contract is ended (complete_contract_end). Does not count as an invoiced period. At most one per contract; may carry no counter part. Insert-only.';

drop index public.quotes_one_contract_quote_per_period_idx;
create unique index quotes_one_contract_quote_per_period_idx
  on public.quotes (contract_id, contract_period_start)
  where quote_type = 'contract' and contract_id is not null
    and not is_final_settlement and not is_counter_settlement;

grant insert (is_counter_settlement) on public.quotes to authenticated;

-- ---------------------------------------------------------------------------
-- contract_counter_settlements (settlement ledger)
-- ---------------------------------------------------------------------------
create table public.contract_counter_settlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contract_id uuid not null references public.contracts (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  quote_id uuid references public.quotes (id) on delete cascade,
  is_final boolean not null default false,
  details jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references public.users (id) on delete set null,
  constraint contract_counter_settlements_period_order check (period_end >= period_start),
  constraint contract_counter_settlements_unique_window unique (contract_id, period_start)
);

comment on table public.contract_counter_settlements is
  'Counter settlement ledger (issue #271): one row per settled window of a contract, also when nothing was billed (quote_id null). The single source of truth for "already settled"; the next unsettled window starts the day after max(period_end), else on the contract start date. quote_id ON DELETE CASCADE: deleting an un-invoiced quote un-settles its windows. organization_id is derived from the contract by derive_contract_counter_settlement_organization_id. Insert/delete only (no UPDATE).';
comment on column public.contract_counter_settlements.organization_id is
  'Denormalized from contracts.organization_id (via contract_id). Never client-writable.';
comment on column public.contract_counter_settlements.period_start is 'First day of the settled window.';
comment on column public.contract_counter_settlements.period_end is 'Last day of the settled window (>= period_start).';
comment on column public.contract_counter_settlements.quote_id is
  'The counter settlement / period / final quote that bills the window; null when nothing was billed. Must belong to the same contract.';
comment on column public.contract_counter_settlements.is_final is
  'True for windows settled by the final balance when the contract ended.';
comment on column public.contract_counter_settlements.details is
  'JSON array with the per-counter figures of the window (included, usage, overage, under-use, amounts) as computed by the application, for display only.';
comment on column public.contract_counter_settlements.created_by is
  'Stamped from auth.uid() by set_created_by (not client-writable).';

create index contract_counter_settlements_organization_id_idx on public.contract_counter_settlements (organization_id);
create index contract_counter_settlements_contract_id_idx on public.contract_counter_settlements (contract_id);
create index contract_counter_settlements_quote_id_idx on public.contract_counter_settlements (quote_id) where quote_id is not null;
create index contract_counter_settlements_created_by_idx on public.contract_counter_settlements (created_by);

alter table public.contract_counter_settlements enable row level security;
alter table public.contract_counter_settlements force row level security;

create or replace function public.derive_contract_counter_settlement_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_quote_contract uuid;
begin
  select c.organization_id into v_org_id
  from public.contracts c
  where c.id = new.contract_id;

  if v_org_id is null then
    raise exception 'contract_counter_settlements.contract_id % does not reference an existing contract', new.contract_id
      using errcode = '23503';
  end if;

  if new.quote_id is not null then
    select q.contract_id into v_quote_contract from public.quotes q where q.id = new.quote_id;
    if v_quote_contract is distinct from new.contract_id then
      raise exception 'contract_counter_settlements.quote_id must be a quote of the same contract'
        using errcode = '23514';
    end if;
  end if;

  new.organization_id := v_org_id;
  return new;
end;
$$;

comment on function public.derive_contract_counter_settlement_organization_id() is
  'BEFORE INSERT trigger on public.contract_counter_settlements: sets organization_id from the contract and requires quote_id (when set) to be a quote of the same contract (23514).';

revoke all on function public.derive_contract_counter_settlement_organization_id() from public, anon, authenticated;

create trigger contract_counter_settlements_derive_organization_id
  before insert on public.contract_counter_settlements
  for each row execute function public.derive_contract_counter_settlement_organization_id();

create trigger contract_counter_settlements_set_created_by
  before insert on public.contract_counter_settlements
  for each row execute function public.set_created_by();

create policy "contract_counter_settlements_select_member"
on public.contract_counter_settlements
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "contract_counter_settlements_insert_owner_planner_finance"
on public.contract_counter_settlements
for insert
to authenticated
with check (public.current_member_role(organization_id) in ('owner', 'planner', 'finance'));

create policy "contract_counter_settlements_delete_owner_planner_finance"
on public.contract_counter_settlements
for delete
to authenticated
using (public.current_member_role(organization_id) in ('owner', 'planner', 'finance'));

revoke all on public.contract_counter_settlements from authenticated, anon;
grant select, delete on public.contract_counter_settlements to authenticated;
grant insert (id, contract_id, period_start, period_end, quote_id, is_final, details)
  on public.contract_counter_settlements to authenticated;

-- Backfill: one row per existing quote that settles a counter period.
insert into public.contract_counter_settlements
  (contract_id, period_start, period_end, quote_id, is_final)
select q.contract_id, q.counter_settlement_start, q.counter_settlement_end, q.id, q.is_final_settlement
from public.quotes q
where q.counter_settlement_start is not null
  and q.contract_id is not null;

-- ---------------------------------------------------------------------------
-- advance_contract_on_invoice(): live body from 20261123120000 plus: a counter
-- settlement quote is not a period either.
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
  v_counter boolean;
begin
  select q.contract_id, q.quote_type, q.is_final_settlement, q.is_counter_settlement
    into v_contract_id, v_type, v_final, v_counter
  from public.quotes q
  where q.id = new.quote_id;

  if v_type = 'contract' and v_contract_id is not null and not v_final and not v_counter then
    update public.contracts
    set invoiced_period_count = invoiced_period_count + 1
    where id = v_contract_id;
  end if;

  return null;
end;
$$;

comment on function public.advance_contract_on_invoice() is
  'AFTER INSERT trigger on public.invoices (issue #211), only for kind = ''invoice'': increments contracts.invoiced_period_count for an invoiced contract period quote (not for a final settlement quote, since 20261123120000, nor a counter settlement quote, since 20261124090000); contracts_compute_next_invoice_date then advances next_invoice_date. credit_invoice() decrements it again.';

-- ---------------------------------------------------------------------------
-- guard_contract_status_change(): live body from 20261123120000 plus: no
-- reactivation once a final settlement exists.
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
    if tg_op = 'UPDATE' and old.status = 'ended' then
      if exists (select 1 from public.quotes q where q.contract_id = new.id and q.is_final_settlement)
         or exists (select 1 from public.contract_counter_settlements s where s.contract_id = new.id and s.is_final) then
        raise exception 'An ended contract with a final settlement cannot be reactivated'
          using errcode = '23514';
      end if;

      if new.end_date is not null
         and new.end_date < (now() at time zone 'UTC')::date then
        raise exception 'An ended contract cannot be reactivated after its end date'
          using errcode = '23514';
      end if;
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
  'BEFORE INSERT OR UPDATE OF status trigger on public.contracts (issues #270, #271): a contract can only become active (from draft or ended, or inserted as active) when contract_missing_baseline_readings returns nothing (23514, ''Missing baseline readings: ...''); ended -> active is refused once a final settlement exists (final settlement quote or final ledger row) and once end_date has passed (23514). SECURITY INVOKER.';

-- ---------------------------------------------------------------------------
-- credit_invoice(): live body from 20261123120000; final AND counter
-- settlement quotes are not periods (neither side of the "latest period"
-- check, no invoiced_period_count rollback).
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

  -- Contract period quote: only the contract's latest invoiced period can be
  -- credited. Rolling back invoiced_period_count by one for an earlier
  -- period would point next_invoice_date at a period that is still invoiced.
  if v_quote.quote_type = 'contract' and v_quote.contract_id is not null
    and not v_quote.is_final_settlement and not v_quote.is_counter_settlement and exists (
    select 1
    from public.invoices i
    join public.quotes q on q.id = i.quote_id
    where q.contract_id = v_quote.contract_id
      and q.quote_type = 'contract'
      and q.id <> v_quote.id
      and not q.is_final_settlement
      and not q.is_counter_settlement
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

  -- Contract period quote: roll the invoiced period back; the BEFORE UPDATE
  -- trigger contracts_compute_next_invoice_date recomputes next_invoice_date.
  if v_quote.quote_type = 'contract' and v_quote.contract_id is not null
    and not v_quote.is_final_settlement and not v_quote.is_counter_settlement then
    update public.contracts
    set invoiced_period_count = greatest(invoiced_period_count - 1, 0)
    where id = v_quote.contract_id;
  end if;

  return v_credit_id;
end;
$$;

comment on function public.credit_invoice(uuid, text) is
  'Credits an invoice (issue #236): creates a credit note in the same number series (negated snapshot and lines, due today, term 0), sets invoices.credited_at on the original, moves the quote back to accepted (else draft), an Invoiced work order back to Completed and rolls a contract period quote''s invoiced_period_count back by one (only for the contract''s latest invoiced period, else 23514; since 20261121100000). Final and counter settlement quotes are not periods: they are exempt from that rule, are ignored by it on the other side, and never change the period count (since 20261123120000 / 20261124090000). owner/finance/administratie only (42501); P0002 not found; 23514 for a credit note or a blank reason; 23505 when already credited. Payments on the original stay as history. Returns the credit note id.';

revoke all on function public.credit_invoice(uuid, text) from public;
revoke all on function public.credit_invoice(uuid, text) from anon;
grant execute on function public.credit_invoice(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- complete_contract_end(): the atomic final balance.
-- ---------------------------------------------------------------------------
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
  'Issue #271: atomically completes a contract''s final balance. Caller must be owner or finance of the contract''s organization (42501; finance may thereby create the final settlement quote and closing readings although the table policies would not let them). Contract must be active, or ended without a final settlement (23514), start_date <= p_end_date <= today (UTC). p_readings [{asset_id, volume_item_id, value}] become accepted readings at p_end_date 12:00 UTC (asset must be covered, counter must be a counter of one of the contract''s volume lines; the reading triggers still apply). p_delete_quote_ids must be contract quotes of this contract without any invoice row. p_quote (nullable) {name, notes, contract_period_start, contract_period_end, counter_settlement_start, counter_settlement_end} + p_lines [{article_id, article_number, description, quantity, unit_price, sort_order}] create the final settlement quote (is_final_settlement). p_settlements [{period_start, period_end, details}] become final ledger rows. The contract becomes ended with end_date = p_end_date and the scheduled-ending columns cleared. Returns the quote id (null when no quote). Amounts are computed by the application; the RPC does not validate prices.';

revoke all on function public.complete_contract_end(uuid, date, jsonb, jsonb, jsonb, jsonb, uuid[]) from public, anon;
grant execute on function public.complete_contract_end(uuid, date, jsonb, jsonb, jsonb, jsonb, uuid[]) to authenticated;
