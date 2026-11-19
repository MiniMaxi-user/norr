-- Follow-up to 20261121090000 (issue #236, QA finding): credit_invoice()
-- always rolled a contract's invoiced_period_count back by one. Crediting an
-- EARLIER period while a later one is still invoiced would point
-- next_invoice_date at the later, still-invoiced period. Now refused with
-- 23514: credit the later periods first. Body otherwise copied verbatim from
-- 20261121090000.

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
  if v_quote.quote_type = 'contract' and v_quote.contract_id is not null and exists (
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
  if v_quote.quote_type = 'contract' and v_quote.contract_id is not null then
    update public.contracts
    set invoiced_period_count = greatest(invoiced_period_count - 1, 0)
    where id = v_quote.contract_id;
  end if;

  return v_credit_id;
end;
$$;

comment on function public.credit_invoice(uuid, text) is
  'Credits an invoice (issue #236): creates a credit note in the same number series (negated snapshot and lines, due today, term 0), sets invoices.credited_at on the original, moves the quote back to accepted (else draft), an Invoiced work order back to Completed and rolls a contract quote''s invoiced_period_count back by one (only for the contract''s latest invoiced period, else 23514; since 20261121100000). owner/finance/administratie only (42501); P0002 not found; 23514 for a credit note or a blank reason; 23505 when already credited. Payments on the original stay as history. Returns the credit note id.';

revoke all on function public.credit_invoice(uuid, text) from public;
revoke all on function public.credit_invoice(uuid, text) from anon;
grant execute on function public.credit_invoice(uuid, text) to authenticated;
