-- Invoice overview, payments and credit notes (issues #234, #235, #236).
--
-- A. Finance gets full invoicing access: public.is_invoicing_member(org) =
--    owner / finance / administratie. Used by every invoice policy, the
--    `invoices` storage bucket policies and create_invoice()'s role check.
-- B. invoices: kind ('invoice' | 'credit_note'), credits_invoice_id,
--    credit_reason, credited_at. unique(quote_id) is replaced by a partial
--    unique index (one LIVE invoice per quote), so a quote can carry a
--    credited invoice + its credit note + a new live invoice. The AFTER INSERT
--    triggers (quote -> invoiced, contract period advance, work order ->
--    Invoiced) only fire for kind = 'invoice'. quote_line_items stay frozen
--    only while the quote has a LIVE invoice (so a credited quote can be
--    corrected and re-invoiced).
-- C. create_invoice(): "already invoiced" = has a live invoice; role check via
--    is_invoicing_member.
-- D. credit_invoice(invoice_id, reason): creates the credit note (same number
--    series, negated snapshot + lines), marks the original credited, reopens
--    the quote (-> accepted, else draft), moves an Invoiced work order back to
--    Completed and rolls a contract quote's invoiced period back.
-- E. payment_method reference list (tenant-configurable) + seed/backfill.
-- F. invoice_payments (immutable: select / insert / delete). Overpayment,
--    credit notes and credited invoices are refused in a BEFORE INSERT trigger.
-- G. View invoice_overview (security_invoker): one row per invoice or credit
--    note with client/quote/contract context, paid_amount, outstanding,
--    payment_status and email_status.

-- ===========================================================================
-- A. is_invoicing_member + widened policies
-- ===========================================================================
create or replace function public.is_invoicing_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_member_role(p_org) in ('owner', 'finance', 'administratie'), false);
$$;

comment on function public.is_invoicing_member(uuid) is
  'True when the caller is an owner, finance or administratie member of the organization (issues #234-#236). The single role boundary for invoices, invoice_lines, invoice_payments, invoice_settings, invoice_email_settings and the invoices storage bucket.';

revoke all on function public.is_invoicing_member(uuid) from public;
revoke all on function public.is_invoicing_member(uuid) from anon;
grant execute on function public.is_invoicing_member(uuid) to authenticated;

-- invoices
drop policy "invoices_select_owner_or_administratie" on public.invoices;
drop policy "invoices_insert_owner_or_administratie" on public.invoices;
drop policy "invoices_update_owner_or_administratie" on public.invoices;

create policy "invoices_select_invoicing_members"
on public.invoices for select to authenticated
using (public.is_invoicing_member(organization_id));

create policy "invoices_insert_invoicing_members"
on public.invoices for insert to authenticated
with check (public.is_invoicing_member(organization_id));

create policy "invoices_update_invoicing_members"
on public.invoices for update to authenticated
using (public.is_invoicing_member(organization_id))
with check (public.is_invoicing_member(organization_id));

-- invoice_lines
drop policy "invoice_lines_select_owner_or_administratie" on public.invoice_lines;
create policy "invoice_lines_select_invoicing_members"
on public.invoice_lines for select to authenticated
using (public.is_invoicing_member(organization_id));

-- invoice_settings
drop policy "invoice_settings_select_owner_or_administratie" on public.invoice_settings;
drop policy "invoice_settings_insert_owner_or_administratie" on public.invoice_settings;
drop policy "invoice_settings_update_owner_or_administratie" on public.invoice_settings;

create policy "invoice_settings_select_invoicing_members"
on public.invoice_settings for select to authenticated
using (public.is_invoicing_member(organization_id));

create policy "invoice_settings_insert_invoicing_members"
on public.invoice_settings for insert to authenticated
with check (public.is_invoicing_member(organization_id));

create policy "invoice_settings_update_invoicing_members"
on public.invoice_settings for update to authenticated
using (public.is_invoicing_member(organization_id))
with check (public.is_invoicing_member(organization_id));

comment on table public.invoice_settings is
  'Per-organization invoicing settings (issue #232): default payment term in days. One row per organization; no row = defaults (30 days). owner/finance/administratie (is_invoicing_member), same boundary as invoices and invoice_email_settings.';

-- invoice_email_settings
drop policy "invoice_email_settings_select_owner_or_administratie" on public.invoice_email_settings;
drop policy "invoice_email_settings_insert_owner_or_administratie" on public.invoice_email_settings;
drop policy "invoice_email_settings_update_owner_or_administratie" on public.invoice_email_settings;

create policy "invoice_email_settings_select_invoicing_members"
on public.invoice_email_settings for select to authenticated
using (public.is_invoicing_member(organization_id));

create policy "invoice_email_settings_insert_invoicing_members"
on public.invoice_email_settings for insert to authenticated
with check (public.is_invoicing_member(organization_id));

create policy "invoice_email_settings_update_invoicing_members"
on public.invoice_email_settings for update to authenticated
using (public.is_invoicing_member(organization_id))
with check (public.is_invoicing_member(organization_id));

comment on table public.invoice_email_settings is
  'Per-organization invoice e-mail configuration (issue #211): sender, CC and subject/body templates. One row per organization. owner/finance/administratie (is_invoicing_member). organization_id is the primary key; RLS WITH CHECK restricts it to organizations where the caller is an invoicing member, and it is not in the UPDATE grant.';

-- storage bucket `invoices` (update/delete policies were dropped in 20261120090000)
drop policy "invoices_bucket_select_owner_or_administratie" on storage.objects;
drop policy "invoices_bucket_insert_owner_or_administratie" on storage.objects;

create policy "invoices_bucket_select_invoicing_members"
on storage.objects for select to authenticated
using (
  bucket_id = 'invoices'
  and public.is_invoicing_member((storage.foldername(name))[1]::uuid)
);

create policy "invoices_bucket_insert_invoicing_members"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'invoices'
  and public.is_invoicing_member((storage.foldername(name))[1]::uuid)
);

-- ===========================================================================
-- B. invoices: kind, credit note columns, one live invoice per quote
-- ===========================================================================
alter table public.invoices
  add column kind text not null default 'invoice',
  add column credits_invoice_id uuid references public.invoices (id) on delete restrict,
  add column credit_reason text,
  add column credited_at timestamptz,
  add constraint invoices_kind_check check (kind in ('invoice', 'credit_note')),
  add constraint invoices_credit_note_link_check
    check ((kind = 'credit_note') = (credits_invoice_id is not null)),
  add constraint invoices_credit_reason_check
    check (
      (kind = 'credit_note' and length(btrim(coalesce(credit_reason, ''))) > 0)
      or (kind = 'invoice' and credit_reason is null)
    ),
  add constraint invoices_credited_at_only_invoices_check
    check (credited_at is null or kind = 'invoice');

comment on column public.invoices.kind is
  '''invoice'' or ''credit_note'' (issue #236). A credit note shares the invoice number series and carries negated amounts.';
comment on column public.invoices.credits_invoice_id is
  'Set only on credit notes: the invoice this credit note reverses. An invoice can be credited once (unique). ON DELETE RESTRICT.';
comment on column public.invoices.credit_reason is
  'Required, non-blank reason on a credit note; null on invoices.';
comment on column public.invoices.credited_at is
  'Set on the ORIGINAL invoice when it is credited (by credit_invoice()). Not client-writable. A credited invoice is no longer "live".';

alter table public.invoices drop constraint invoices_quote_id_key;

create unique index invoices_one_live_invoice_per_quote
  on public.invoices (quote_id)
  where kind = 'invoice' and credited_at is null;

create unique index invoices_credits_invoice_id_key
  on public.invoices (credits_invoice_id)
  where credits_invoice_id is not null;

create index invoices_quote_id_idx on public.invoices (quote_id);

comment on column public.invoices.quote_id is
  'The quote this invoice or credit note belongs to. A quote has at most one LIVE invoice (partial unique index invoices_one_live_invoice_per_quote: kind = ''invoice'' and credited_at is null) but can also carry credited invoices and their credit notes. A quote with an invoice cannot be deleted (FK without cascade, SQLSTATE 23503).';

-- Triggers that react to a NEW INVOICE must ignore credit notes.
drop trigger invoices_advance_contract_period on public.invoices;
create trigger invoices_advance_contract_period
  after insert on public.invoices
  for each row when (new.kind = 'invoice')
  execute function public.advance_contract_on_invoice();

drop trigger invoices_set_quote_invoiced on public.invoices;
create trigger invoices_set_quote_invoiced
  after insert on public.invoices
  for each row when (new.kind = 'invoice')
  execute function public.set_quote_invoiced_on_invoice();

drop trigger invoices_set_work_order_invoiced on public.invoices;
create trigger invoices_set_work_order_invoiced
  after insert on public.invoices
  for each row when (new.kind = 'invoice')
  execute function public.set_work_order_invoiced_on_invoice();

comment on function public.advance_contract_on_invoice() is
  'AFTER INSERT trigger on public.invoices (issue #211), only for kind = ''invoice'': increments contracts.invoiced_period_count for an invoiced contract quote; contracts_compute_next_invoice_date then advances next_invoice_date. credit_invoice() decrements it again.';

-- Quote lines are frozen only while the quote has a LIVE invoice.
create or replace function public.guard_invoiced_quote_line_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE')
     and exists (
       select 1 from public.invoices
       where quote_id = old.quote_id and kind = 'invoice' and credited_at is null
     ) then
    raise exception 'This quote has been invoiced; its line items can no longer be changed.' using errcode = '23514';
  end if;
  if tg_op in ('INSERT', 'UPDATE')
     and exists (
       select 1 from public.invoices
       where quote_id = new.quote_id and kind = 'invoice' and credited_at is null
     ) then
    raise exception 'This quote has been invoiced; its line items can no longer be changed.' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

comment on function public.guard_invoiced_quote_line_items() is
  'BEFORE INSERT/UPDATE/DELETE trigger on quote_line_items (issue #232): the lines of a quote with a LIVE invoice (not credited) are frozen, so the quote keeps matching its invoice. After a credit note the quote can be corrected and invoiced again (issue #236).';

-- next_invoice_number() re-checks the role itself (it is granted to
-- authenticated): widen it to is_invoicing_member. Body otherwise identical to
-- the live one (NULL role = non-member must still be refused).
create or replace function public.next_invoice_number(p_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next bigint;
begin
  if not public.is_invoicing_member(p_organization_id) then
    raise exception 'Only owner, finance or administratie members may generate an invoice number for this organization'
      using errcode = '42501';
  end if;

  insert into public.invoice_number_sequences (organization_id, last_number)
  values (p_organization_id, 1)
  on conflict (organization_id)
  do update set last_number = public.invoice_number_sequences.last_number + 1,
                updated_at = now()
  returning last_number into v_next;

  return 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(v_next::text, 4, '0');
end;
$$;

do $$
begin
  execute format(
    'comment on function public.next_invoice_number(uuid) is %L',
    replace(obj_description('public.next_invoice_number(uuid)'::regprocedure, 'pg_proc'),
      'in (''owner'', ''administratie'')', 'via is_invoicing_member (owner, finance, administratie; widened in 20261121090000)')
  );
end;
$$;

-- ===========================================================================
-- C. create_invoice: live-invoice check + is_invoicing_member
-- ===========================================================================
create or replace function public.create_invoice(p_quote_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.quotes%rowtype;
  v_status text;
  v_number text;
  v_invoice_id uuid;
begin
  -- Row lock: two concurrent "Generate invoice" clicks serialize here.
  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'Quote not found, or you do not have permission to view it.' using errcode = 'P0002';
  end if;

  if not public.is_invoicing_member(v_quote.organization_id) then
    raise exception 'Only an owner, finance or administratie member can generate invoices.' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.invoices
    where quote_id = p_quote_id and kind = 'invoice' and credited_at is null
  ) then
    raise exception 'This quote has already been invoiced.' using errcode = '23505';
  end if;

  if v_quote.is_auto_draft then
    raise exception 'This is the automatic draft of a work order. Create the quote from the work order first.' using errcode = '23514';
  end if;

  select rli.value into v_status from public.reference_list_items rli where rli.id = v_quote.status_id;
  if v_status in ('rejected', 'expired', 'invoiced') then
    raise exception 'A quote with status % cannot be invoiced.', v_status using errcode = '23514';
  end if;

  if not exists (select 1 from public.quote_line_items where quote_id = p_quote_id) then
    raise exception 'A quote without line items cannot be invoiced.' using errcode = '23514';
  end if;

  if (select o.own_client_id from public.organizations o where o.id = v_quote.organization_id) is null then
    raise exception 'Configure your own company details in Settings → Company before generating an invoice.'
      using errcode = '23514';
  end if;

  v_number := public.next_invoice_number(v_quote.organization_id);

  -- The snapshot columns are NOT NULL, so the row starts with placeholders
  -- that snapshot_invoice() overwrites in this same transaction (it needs the
  -- invoice id for invoice_lines, hence insert first, snapshot second).
  insert into public.invoices (
    quote_id, invoice_number, invoice_date, due_date, payment_term_days, subtotal, vat_total, total, recipient
  )
  values (
    p_quote_id, v_number, (now() at time zone 'Europe/Amsterdam')::date, (now() at time zone 'Europe/Amsterdam')::date,
    0, 0, 0, 0, '{}'::jsonb
  )
  returning id into v_invoice_id;

  perform public.snapshot_invoice(v_invoice_id);

  return v_invoice_id;
end;
$$;

comment on function public.create_invoice(uuid) is
  'Creates the invoice for a quote (issues #119/#211/#232/#234): owner/finance/administratie only (is_invoicing_member); refuses auto-draft, quotes that already have a LIVE invoice (a credited one does not count), rejected/expired, line-less quotes and organizations without own company details. Mints the number, inserts (AFTER INSERT triggers set the quote/contract/work order state) and snapshots amounts, lines, dates and addresses. The direct INSERT grant on invoices is revoked: this is the only way in.';

-- ===========================================================================
-- D. credit_invoice
-- ===========================================================================
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
  'Credits an invoice (issue #236): creates a credit note in the same number series (negated snapshot and lines, due today, term 0), sets invoices.credited_at on the original, moves the quote back to accepted (else draft), an Invoiced work order back to Completed and rolls a contract quote''s invoiced_period_count back by one. owner/finance/administratie only (42501); P0002 not found; 23514 for a credit note or a blank reason; 23505 when already credited. Payments on the original stay as history. Returns the credit note id.';

revoke all on function public.credit_invoice(uuid, text) from public;
revoke all on function public.credit_invoice(uuid, text) from anon;
grant execute on function public.credit_invoice(uuid, text) to authenticated;

-- ===========================================================================
-- E. payment_method reference list
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.seed_default_reference_lists(p_organization_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_asset_type_list_id uuid;
  v_asset_status_list_id uuid;
  v_contact_role_list_id uuid;
  v_asset_subtype_list_id uuid;
  v_hvac_id uuid;
  v_electrical_id uuid;
  v_plumbing_id uuid;
  v_generator_id uuid;
  v_other_id uuid;
  v_work_order_status_list_id uuid;
  v_work_order_priority_list_id uuid;
  v_contract_type_list_id uuid;
  v_sla_tier_list_id uuid;
  v_billing_terms_list_id uuid;
  v_billing_period_list_id uuid;
  v_maintenance_id uuid;
  v_service_id uuid;
  v_installation_id uuid;
  v_warranty_id uuid;
  v_time_entry_type_list_id uuid;
  v_quote_status_list_id uuid;
  v_asset_brand_list_id uuid;
  v_activity_type_list_id uuid;
  v_activity_status_list_id uuid;
  v_article_unit_list_id uuid;
  v_article_manufacturer_list_id uuid;
  v_vat_rate_list_id uuid;
  v_region_list_id uuid;
  v_payment_method_list_id uuid;
begin
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'asset_type', 'Asset Type')
  on conflict (organization_id, list_key) do nothing;

  select id into v_asset_type_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'asset_type';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_asset_type_list_id, p_organization_id, 'hvac', 'HVAC', 1, false),
    (v_asset_type_list_id, p_organization_id, 'electrical', 'Electrical', 2, false),
    (v_asset_type_list_id, p_organization_id, 'plumbing', 'Plumbing', 3, false),
    (v_asset_type_list_id, p_organization_id, 'generator', 'Generator', 4, false),
    (v_asset_type_list_id, p_organization_id, 'other', 'Other', 5, true)
  on conflict (reference_list_id, value) do nothing;

  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'asset_status', 'Asset Status')
  on conflict (organization_id, list_key) do nothing;

  select id into v_asset_status_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'asset_status';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default, color)
  values
    (v_asset_status_list_id, p_organization_id, 'active', 'Active', 1, true, 'green'),
    (v_asset_status_list_id, p_organization_id, 'in_repair', 'In Repair', 2, false, 'amber'),
    (v_asset_status_list_id, p_organization_id, 'decommissioned', 'Decommissioned', 3, false, 'gray')
  on conflict (reference_list_id, value) do nothing;

  -- contact_role: for contacts.role_item_id. Not a dependent list — flat,
  -- like asset_type/asset_status.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'contact_role', 'Contact Role')
  on conflict (organization_id, list_key) do nothing;

  select id into v_contact_role_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'contact_role';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_contact_role_list_id, p_organization_id, 'primary', 'Primary', 1, true),
    (v_contact_role_list_id, p_organization_id, 'billing', 'Billing', 2, false),
    (v_contact_role_list_id, p_organization_id, 'site_manager', 'Site manager', 3, false),
    (v_contact_role_list_id, p_organization_id, 'technical', 'Technical', 4, false)
  on conflict (reference_list_id, value) do nothing;

  -- asset_subtype: pilot dependent list, parent_list_key = asset_type. Each
  -- item's parent_item_id points at the matching asset_type item just
  -- seeded/looked-up above, in this same organization.
  insert into public.reference_lists (organization_id, list_key, name, parent_list_key)
  values (p_organization_id, 'asset_subtype', 'Asset Sub-type', 'asset_type')
  on conflict (organization_id, list_key) do nothing;

  select id into v_asset_subtype_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'asset_subtype';

  select id into v_hvac_id from public.reference_list_items where reference_list_id = v_asset_type_list_id and value = 'hvac';
  select id into v_electrical_id from public.reference_list_items where reference_list_id = v_asset_type_list_id and value = 'electrical';
  select id into v_plumbing_id from public.reference_list_items where reference_list_id = v_asset_type_list_id and value = 'plumbing';
  select id into v_generator_id from public.reference_list_items where reference_list_id = v_asset_type_list_id and value = 'generator';
  select id into v_other_id from public.reference_list_items where reference_list_id = v_asset_type_list_id and value = 'other';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, parent_item_id)
  values
    (v_asset_subtype_list_id, p_organization_id, 'compressor', 'Compressor', 1, v_hvac_id),
    (v_asset_subtype_list_id, p_organization_id, 'thermostat', 'Thermostat', 2, v_hvac_id),
    (v_asset_subtype_list_id, p_organization_id, 'ductwork', 'Ductwork', 3, v_hvac_id),
    (v_asset_subtype_list_id, p_organization_id, 'panel', 'Panel', 4, v_electrical_id),
    (v_asset_subtype_list_id, p_organization_id, 'wiring', 'Wiring', 5, v_electrical_id),
    (v_asset_subtype_list_id, p_organization_id, 'lighting', 'Lighting', 6, v_electrical_id),
    (v_asset_subtype_list_id, p_organization_id, 'pipe', 'Pipe', 7, v_plumbing_id),
    (v_asset_subtype_list_id, p_organization_id, 'valve', 'Valve', 8, v_plumbing_id),
    (v_asset_subtype_list_id, p_organization_id, 'pump', 'Pump', 9, v_plumbing_id),
    (v_asset_subtype_list_id, p_organization_id, 'engine', 'Engine', 10, v_generator_id),
    (v_asset_subtype_list_id, p_organization_id, 'transfer_switch', 'Transfer switch', 11, v_generator_id),
    (v_asset_subtype_list_id, p_organization_id, 'other_subtype', 'Other', 12, v_other_id)
  on conflict (reference_list_id, value) do nothing;

  -- work_order_status: for work_orders.status_id. Flat list, ordered
  -- lifecycle: New (default) -> Scheduled -> Checkout -> En Route ->
  -- In Progress -> To review -> Completed -> Invoiced. `to_review` label
  -- corrected to English (`To review`) by this migration — see header;
  -- previously shipped as Dutch (`Te controleren`) by
  -- 20260920110000_work_order_to_review_status.sql.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'work_order_status', 'Work Order Status')
  on conflict (organization_id, list_key) do nothing;

  select id into v_work_order_status_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'work_order_status';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_work_order_status_list_id, p_organization_id, 'new', 'New', 1, true),
    (v_work_order_status_list_id, p_organization_id, 'scheduled', 'Scheduled', 2, false),
    (v_work_order_status_list_id, p_organization_id, 'checkout', 'Checked out', 3, false),
    (v_work_order_status_list_id, p_organization_id, 'en_route', 'En Route', 4, false),
    (v_work_order_status_list_id, p_organization_id, 'in_progress', 'In Progress', 5, false),
    (v_work_order_status_list_id, p_organization_id, 'to_review', 'To review', 6, false),
    (v_work_order_status_list_id, p_organization_id, 'completed', 'Completed', 7, false),
    (v_work_order_status_list_id, p_organization_id, 'invoiced', 'Invoiced', 8, false)
  on conflict (reference_list_id, value) do nothing;

  -- work_order_priority: for work_orders.priority_id. Flat list.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'work_order_priority', 'Work Order Priority')
  on conflict (organization_id, list_key) do nothing;

  select id into v_work_order_priority_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'work_order_priority';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_work_order_priority_list_id, p_organization_id, 'low', 'Low', 1, false),
    (v_work_order_priority_list_id, p_organization_id, 'normal', 'Normal', 2, true),
    (v_work_order_priority_list_id, p_organization_id, 'high', 'High', 3, false),
    (v_work_order_priority_list_id, p_organization_id, 'urgent', 'Urgent', 4, false)
  on conflict (reference_list_id, value) do nothing;

  -- contract_type: for contracts.type_id. Flat list.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'contract_type', 'Contract Type')
  on conflict (organization_id, list_key) do nothing;

  select id into v_contract_type_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'contract_type';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_contract_type_list_id, p_organization_id, 'maintenance', 'Maintenance', 1, true),
    (v_contract_type_list_id, p_organization_id, 'service', 'Service', 2, false),
    (v_contract_type_list_id, p_organization_id, 'installation', 'Installation', 3, false),
    (v_contract_type_list_id, p_organization_id, 'warranty', 'Warranty', 4, false)
  on conflict (reference_list_id, value) do nothing;

  -- sla_tier: dependent list, parent_list_key = contract_type. A few tiers
  -- per contract type. `value` must be unique per LIST (not per parent
  -- group), so each item's slug is prefixed with its parent type.
  insert into public.reference_lists (organization_id, list_key, name, parent_list_key)
  values (p_organization_id, 'sla_tier', 'SLA Tier', 'contract_type')
  on conflict (organization_id, list_key) do nothing;

  select id into v_sla_tier_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'sla_tier';

  select id into v_maintenance_id from public.reference_list_items where reference_list_id = v_contract_type_list_id and value = 'maintenance';
  select id into v_service_id from public.reference_list_items where reference_list_id = v_contract_type_list_id and value = 'service';
  select id into v_installation_id from public.reference_list_items where reference_list_id = v_contract_type_list_id and value = 'installation';
  select id into v_warranty_id from public.reference_list_items where reference_list_id = v_contract_type_list_id and value = 'warranty';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, parent_item_id)
  values
    (v_sla_tier_list_id, p_organization_id, 'maintenance_standard', 'Standard', 1, v_maintenance_id),
    (v_sla_tier_list_id, p_organization_id, 'maintenance_priority', 'Priority', 2, v_maintenance_id),
    (v_sla_tier_list_id, p_organization_id, 'maintenance_premium', 'Premium', 3, v_maintenance_id),
    (v_sla_tier_list_id, p_organization_id, 'service_standard', 'Standard', 4, v_service_id),
    (v_sla_tier_list_id, p_organization_id, 'service_express', 'Express', 5, v_service_id),
    (v_sla_tier_list_id, p_organization_id, 'installation_standard', 'Standard', 6, v_installation_id),
    (v_sla_tier_list_id, p_organization_id, 'installation_expedited', 'Expedited', 7, v_installation_id),
    (v_sla_tier_list_id, p_organization_id, 'warranty_standard', 'Standard', 8, v_warranty_id),
    (v_sla_tier_list_id, p_organization_id, 'warranty_extended', 'Extended', 9, v_warranty_id)
  on conflict (reference_list_id, value) do nothing;

  -- billing_terms: for contracts.billing_terms_id. Flat, standalone list.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'billing_terms', 'Billing Terms')
  on conflict (organization_id, list_key) do nothing;

  select id into v_billing_terms_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'billing_terms';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default, interval_months)
  values
    (v_billing_terms_list_id, p_organization_id, 'monthly', 'Monthly', 1, true, 1),
    (v_billing_terms_list_id, p_organization_id, 'quarterly', 'Quarterly', 2, false, 3),
    (v_billing_terms_list_id, p_organization_id, 'annually', 'Annually', 3, false, 12),
    (v_billing_terms_list_id, p_organization_id, 'per_visit', 'Per-visit', 4, false, null),
    (v_billing_terms_list_id, p_organization_id, 'one_time', 'One-time', 5, false, null)
  on conflict (reference_list_id, value) do nothing;

  -- billing_period: for contracts.billing_period_id (issue #122). Flat,
  -- standalone list (not dependent on contract_type, not a repurposing of
  -- billing_terms).
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'billing_period', 'Billing Period')
  on conflict (organization_id, list_key) do nothing;

  select id into v_billing_period_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'billing_period';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_billing_period_list_id, p_organization_id, 'monthly', 'Monthly', 1, true),
    (v_billing_period_list_id, p_organization_id, 'quarterly', 'Quarterly', 2, false),
    (v_billing_period_list_id, p_organization_id, 'annually', 'Annually', 3, false)
  on conflict (reference_list_id, value) do nothing;

  -- time_entry_type: for time_entries.entry_type_id. Flat list.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'time_entry_type', 'Time Entry Type')
  on conflict (organization_id, list_key) do nothing;

  select id into v_time_entry_type_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'time_entry_type';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_time_entry_type_list_id, p_organization_id, 'labor', 'Labor', 1, true),
    (v_time_entry_type_list_id, p_organization_id, 'travel', 'Travel', 2, false),
    (v_time_entry_type_list_id, p_organization_id, 'break', 'Break', 3, false)
  on conflict (reference_list_id, value) do nothing;

  -- quote_status: for quotes.status_id. Flat list, ordered lifecycle: Draft
  -- (default) -> Invoiced.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'quote_status', 'Quote Status')
  on conflict (organization_id, list_key) do nothing;

  select id into v_quote_status_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'quote_status';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_quote_status_list_id, p_organization_id, 'draft', 'Draft', 1, true)
  on conflict (reference_list_id, value) do nothing;

  -- invoiced: NEW quote_status item (issues #210/#211) — set on a contract
  -- quote once it has been invoiced. Own insert (not folded into the block
  -- above) so the original five rows stay byte-identical; color applied via
  -- the insert itself, never overwritten on conflict.
  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default, color)
  values
    (v_quote_status_list_id, p_organization_id, 'invoiced', 'Invoiced', 2, false, 'green')
  on conflict (reference_list_id, value) do nothing;

  -- asset_brand: for asset_models.brand_item_id. Flat, like
  -- asset_type/asset_status/contact_role — not dependent on anything.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'asset_brand', 'Brand')
  on conflict (organization_id, list_key) do nothing;

  select id into v_asset_brand_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'asset_brand';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_asset_brand_list_id, p_organization_id, 'kyocera', 'Kyocera', 1, false),
    (v_asset_brand_list_id, p_organization_id, 'canon', 'Canon', 2, false),
    (v_asset_brand_list_id, p_organization_id, 'ricoh', 'Ricoh', 3, false),
    (v_asset_brand_list_id, p_organization_id, 'xerox', 'Xerox', 4, false),
    (v_asset_brand_list_id, p_organization_id, 'other_brand', 'Other', 5, true)
  on conflict (reference_list_id, value) do nothing;

  -- activity_type: for activities.type_id. Flat list. No item is marked
  -- is_default — the type picker always requires an explicit choice.
  -- Labels translated to English by 20260919090000_translate_default_
  -- reference_list_labels_to_english.sql (issue #196): value slugs
  -- (bel_activiteit/storing/onderhoud/afspraak/email_opvolging) are
  -- UNCHANGED — application code (e.g.
  -- app/(app)/activities/actions.ts) compares against them directly.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'activity_type', 'Activity Type')
  on conflict (organization_id, list_key) do nothing;

  select id into v_activity_type_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'activity_type';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default, icon, planning_default)
  values
    (v_activity_type_list_id, p_organization_id, 'bel_activiteit', 'Call activity', 1, false, 'Phone', false),
    (v_activity_type_list_id, p_organization_id, 'storing', 'Breakdown', 2, false, 'AlertTriangle', true),
    (v_activity_type_list_id, p_organization_id, 'onderhoud', 'Maintenance', 3, false, 'Settings', true),
    (v_activity_type_list_id, p_organization_id, 'afspraak', 'Appointment', 4, false, 'CalendarDays', false),
    (v_activity_type_list_id, p_organization_id, 'email_opvolging', 'Email follow-up', 5, false, 'Mail', false)
  on conflict (reference_list_id, value) do update set icon = excluded.icon;

  -- inspectie: NEW activity_type item (issue #164, Planning module). Own
  -- `on conflict do nothing` clause — deliberately NOT folded into the
  -- `on conflict do update set icon = excluded.icon` clause above (see
  -- 20260915090000_region_reference_list.sql's header design note 3: that
  -- clause exists only to re-assert icon on the 5 pre-existing rows across
  -- repeated seed runs; widening it to this row too risks clobbering a
  -- tenant's own edited icon on it if this function is ever re-run oddly).
  -- Label translated to English (issue #196) — value slug `inspectie`
  -- unchanged.
  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, icon, planning_default)
  values
    (v_activity_type_list_id, p_organization_id, 'inspectie', 'Inspection', 6, 'Search', true)
  on conflict (reference_list_id, value) do nothing;

  -- Set inspectie's color to green (matching the design mockup) — scoped so
  -- it only ever touches this one new row, and only while still unset (never
  -- overwrites a tenant's own edit).
  update public.reference_list_items
  set color = 'green'
  where reference_list_id = v_activity_type_list_id
    and value = 'inspectie'
    and color is null;

  -- activity_status: for activities.status_id. Flat list, ordered lifecycle:
  -- Open (default) -> In Progress -> Completed. Labels translated to English
  -- (issue #196) — value slugs (open/in_progress/completed) unchanged.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'activity_status', 'Activity Status')
  on conflict (organization_id, list_key) do nothing;

  select id into v_activity_status_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'activity_status';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_activity_status_list_id, p_organization_id, 'open', 'Open', 1, true),
    (v_activity_status_list_id, p_organization_id, 'in_progress', 'In Progress', 2, false),
    (v_activity_status_list_id, p_organization_id, 'completed', 'Completed', 3, false)
  on conflict (reference_list_id, value) do nothing;

  -- article_unit: for articles.unit_item_id. Flat. Piece is the sensible
  -- tenant default (most articles in an FSM parts catalog are discrete
  -- units, not bulk liquid/weight). Label translated to English (issue
  -- #196) — value slug `stuk` unchanged; `liter`/`kg` labels were already
  -- plain English/international units, left as-is.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'article_unit', 'Article Unit')
  on conflict (organization_id, list_key) do nothing;

  select id into v_article_unit_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'article_unit';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_article_unit_list_id, p_organization_id, 'stuk', 'Piece', 1, true),
    (v_article_unit_list_id, p_organization_id, 'liter', 'Liter', 2, false),
    (v_article_unit_list_id, p_organization_id, 'kg', 'Kg', 3, false)
  on conflict (reference_list_id, value) do nothing;

  -- volume: for the Settings-managed "Volume" list (issue #131, "Beheren
  -- 'Volume'"). Dependent list, parent_list_key = article_unit. Deliberately
  -- seeds ZERO items — a Volume value is fully bespoke per tenant, unlike
  -- every list above.
  insert into public.reference_lists (organization_id, list_key, name, parent_list_key)
  values (p_organization_id, 'volume', 'Volume', 'article_unit')
  on conflict (organization_id, list_key) do nothing;

  -- article_manufacturer: for articles.manufacturer_item_id. Flat.
  -- Deliberately minimal (unlike asset_brand's printer-vertical seed) — a
  -- tenant's parts manufacturers are genuinely open-ended and specific to
  -- what they stock, so a single "Other" catch-all default is the honest
  -- starting point; the owner adds their own real manufacturers via
  -- Settings.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'article_manufacturer', 'Manufacturer')
  on conflict (organization_id, list_key) do nothing;

  select id into v_article_manufacturer_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'article_manufacturer';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_article_manufacturer_list_id, p_organization_id, 'other_manufacturer', 'Other', 1, true)
  on conflict (reference_list_id, value) do nothing;

  -- vat_rate: for articles.vat_rate_item_id. Flat. `value` is the literal
  -- numeric percentage as text ('0'/'9'/'21'), not a slug, so application
  -- code can do Number(item.value) directly for tax math instead of
  -- maintaining a separate mapping. 21% (the Dutch standard rate) is the
  -- default.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'vat_rate', 'VAT Rate')
  on conflict (organization_id, list_key) do nothing;

  select id into v_vat_rate_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'vat_rate';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_vat_rate_list_id, p_organization_id, '0', '0%', 1, false),
    (v_vat_rate_list_id, p_organization_id, '9', '9%', 2, false),
    (v_vat_rate_list_id, p_organization_id, '21', '21%', 3, true)
  on conflict (reference_list_id, value) do nothing;

  -- region: for sites.region_id / memberships.region_id (issue #164,
  -- Planning module; user-facing label is "Service Area" per issue #192, the
  -- internal list_key stays `region`). Flat, root-level list, like
  -- asset_type/contact_role — not dependent on anything. Each item's
  -- province grouping lives in the generic `description` column, not a
  -- second list level (see 20260915090000_region_reference_list.sql's header
  -- design note 2) — those description values are real Dutch province names,
  -- not translatable UI copy, and are left as-is. Item labels translated to
  -- English (issue #196) — value slugs (regio_noord/regio_midden/regio_zuid/
  -- intern_werkplaats) unchanged.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'region', 'Region')
  on conflict (organization_id, list_key) do nothing;

  select id into v_region_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'region';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, description, sort_order)
  values
    (v_region_list_id, p_organization_id, 'regio_noord', 'North Region', 'Groningen · Friesland · Drenthe', 1),
    (v_region_list_id, p_organization_id, 'regio_midden', 'Central Region', 'Utrecht · Gelderland', 2),
    (v_region_list_id, p_organization_id, 'regio_zuid', 'South Region', 'Brabant · Limburg', 3),
    (v_region_list_id, p_organization_id, 'intern_werkplaats', 'Internal / Workshop', null, 4)
  on conflict (reference_list_id, value) do nothing;

  -- payment_method: for invoice_payments.method_id (issue #235). Flat,
  -- tenant-configurable list; bank transfer is the default. Value slugs are
  -- referenced by the app (offset = settled against another document).
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'payment_method', 'Payment Method')
  on conflict (organization_id, list_key) do nothing;

  select id into v_payment_method_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'payment_method';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_payment_method_list_id, p_organization_id, 'bank_transfer', 'Bank transfer', 1, true),
    (v_payment_method_list_id, p_organization_id, 'pin', 'Card (PIN)', 2, false),
    (v_payment_method_list_id, p_organization_id, 'cash', 'Cash', 3, false),
    (v_payment_method_list_id, p_organization_id, 'offset', 'Offset', 4, false)
  on conflict (reference_list_id, value) do nothing;

  -- Self-heal: re-verify every list above (plus any earlier picklist) still
  -- has its intended default item, in case is_default was reset outside this
  -- function's control (see 20260907100000_fix_seed_default_reference_lists_
  -- regression_3.sql's header for the full mechanism). Preserved verbatim —
  -- region/volume have no is_default concept, so neither needs an entry here
  -- (same as asset_subtype/sla_tier).
  perform public.ensure_reference_list_defaults(p_organization_id);
end;
$function$
;

do $$
begin
  execute format(
    'comment on function public.seed_default_reference_lists(uuid) is %L',
    obj_description('public.seed_default_reference_lists(uuid)'::regprocedure, 'pg_proc')
      || ' Extended in 20261121090000_invoice_payments_and_credit_notes.sql (issue #235) with a `payment_method` block (bank_transfer default, pin, cash, offset); copied forward from the live body via pg_get_functiondef.'
  );
end;
$$;

CREATE OR REPLACE FUNCTION public.ensure_reference_list_defaults(p_organization_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.reference_list_items i
  set is_default = true
  from public.reference_lists rl
  join (
    values
      ('asset_type', 'other'),
      ('asset_status', 'active'),
      ('contact_role', 'primary'),
      ('work_order_status', 'new'),
      ('work_order_priority', 'normal'),
      ('contract_type', 'maintenance'),
      ('billing_terms', 'monthly'),
      ('billing_period', 'monthly'),
      ('time_entry_type', 'labor'),
      ('quote_status', 'draft'),
      ('asset_brand', 'other_brand'),
      ('activity_status', 'open'),
      ('article_unit', 'stuk'),
      ('article_manufacturer', 'other_manufacturer'),
      ('vat_rate', '21'),
      ('payment_method', 'bank_transfer')
  ) as defaults (list_key, default_value)
    on defaults.list_key = rl.list_key
  where rl.id = i.reference_list_id
    and rl.organization_id = p_organization_id
    and i.value = defaults.default_value
    and not exists (
      select 1 from public.reference_list_items d
      where d.reference_list_id = i.reference_list_id and d.is_default
    );
end;
$function$
;

select public.seed_default_reference_lists(o.id) from public.organizations o;

-- ===========================================================================
-- F. invoice_payments
-- ===========================================================================
create table public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  paid_on date not null,
  amount numeric(12, 2) not null,
  method_id uuid not null references public.reference_list_items (id),
  note text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint invoice_payments_amount_positive check (amount > 0)
);

comment on table public.invoice_payments is
  'Payments registered against an invoice (issue #235). Immutable: select/insert/delete only. organization_id is derived from the invoice. Overpayment, payments on credit notes and on credited invoices are refused by invoice_payments_validate_insert. Read/insert: owner/finance/administratie; delete: the creator or an owner.';
comment on column public.invoice_payments.method_id is
  'Item of the organization''s payment_method reference list (validated by trigger).';
comment on column public.invoice_payments.created_by is 'Set by the set_created_by trigger; may delete their own payment.';

create index invoice_payments_organization_id_idx on public.invoice_payments (organization_id);
create index invoice_payments_invoice_id_idx on public.invoice_payments (invoice_id);
create index invoice_payments_method_id_idx on public.invoice_payments (method_id);
create index invoice_payments_created_by_idx on public.invoice_payments (created_by);

alter table public.invoice_payments enable row level security;
alter table public.invoice_payments force row level security;

create or replace function public.validate_invoice_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_method_org uuid;
  v_method_key text;
  v_paid numeric(12, 2);
  v_outstanding numeric(12, 2);
begin
  -- Lock the invoice: concurrent payments and credit_invoice() serialize here.
  select * into v_invoice from public.invoices where id = new.invoice_id for update;
  if not found then
    raise exception 'invoice_payments.invoice_id % does not reference an existing invoice', new.invoice_id
      using errcode = '23503';
  end if;

  new.organization_id := v_invoice.organization_id;

  select rl.organization_id, rl.list_key into v_method_org, v_method_key
  from public.reference_list_items rli
  join public.reference_lists rl on rl.id = rli.reference_list_id
  where rli.id = new.method_id;
  if v_method_org is null then
    raise exception 'invoice_payments.method_id % does not reference an existing reference_list_items row', new.method_id
      using errcode = '23503';
  elsif v_method_key <> 'payment_method' then
    raise exception 'invoice_payments.method_id must reference an item from the payment_method reference list (got list_key=%)', v_method_key
      using errcode = '23514';
  elsif v_method_org <> v_invoice.organization_id then
    raise exception 'invoice_payments.method_id must belong to the same organization as the invoice'
      using errcode = '23514';
  end if;

  if v_invoice.kind = 'credit_note' then
    raise exception 'Payments cannot be registered on a credit note.' using errcode = '23514';
  end if;
  if v_invoice.credited_at is not null then
    raise exception 'Payments cannot be registered on a credited invoice.' using errcode = '23514';
  end if;

  select coalesce(sum(p.amount), 0) into v_paid
  from public.invoice_payments p
  where p.invoice_id = new.invoice_id;

  v_outstanding := v_invoice.total - v_paid;
  if new.amount > v_outstanding then
    raise exception 'The payment exceeds the outstanding amount (€ %).', to_char(greatest(v_outstanding, 0), 'FM999999990.00')
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.validate_invoice_payment() is
  'BEFORE INSERT trigger on invoice_payments (issue #235): locks the invoice, derives organization_id, validates method_id belongs to the org''s payment_method list, refuses credit notes, credited invoices and overpayment (23514, message carries the outstanding amount).';

create trigger invoice_payments_validate_insert
  before insert on public.invoice_payments
  for each row execute function public.validate_invoice_payment();

create trigger invoice_payments_set_created_by
  before insert on public.invoice_payments
  for each row execute function public.set_created_by();

create policy "invoice_payments_select_invoicing_members"
on public.invoice_payments for select to authenticated
using (public.is_invoicing_member(organization_id));

create policy "invoice_payments_insert_invoicing_members"
on public.invoice_payments for insert to authenticated
with check (public.is_invoicing_member(organization_id));

create policy "invoice_payments_delete_creator_or_owner"
on public.invoice_payments for delete to authenticated
using (
  public.is_invoicing_member(organization_id)
  and (created_by = auth.uid() or public.current_member_role(organization_id) = 'owner')
);

revoke all on public.invoice_payments from authenticated;
revoke all on public.invoice_payments from anon;
grant select on public.invoice_payments to authenticated;
grant insert (invoice_id, paid_on, amount, method_id, note) on public.invoice_payments to authenticated;
grant delete on public.invoice_payments to authenticated;

-- ===========================================================================
-- G. invoice_overview
-- ===========================================================================
create view public.invoice_overview
with (security_invoker = true)
as
select
  i.id,
  i.organization_id,
  i.quote_id,
  i.invoice_number,
  i.kind,
  i.credits_invoice_id,
  i.credit_reason,
  i.credited_at,
  i.invoice_date,
  i.due_date,
  i.payment_term_days,
  i.currency,
  i.subtotal,
  i.vat_total,
  i.total,
  i.pdf_path,
  i.generated_at,
  i.generated_by,
  i.emailed_to,
  i.emailed_at,
  i.email_error,
  q.client_id,
  c.name as client_name,
  q.quote_number,
  q.name as quote_name,
  q.quote_type,
  q.contract_id,
  ct.contract_number,
  coalesce(pay.paid_amount, 0)::numeric(12, 2) as paid_amount,
  case
    when i.kind = 'credit_note' or i.credited_at is not null then 0
    else greatest(i.total - coalesce(pay.paid_amount, 0), 0)
  end::numeric(12, 2) as outstanding,
  case
    when i.kind = 'credit_note' then 'credit_note'
    when i.credited_at is not null then 'credited'
    when coalesce(pay.paid_amount, 0) >= i.total then 'paid'
    when i.due_date < (now() at time zone 'Europe/Amsterdam')::date then 'overdue'
    when coalesce(pay.paid_amount, 0) > 0 then 'partially_paid'
    else 'open'
  end as payment_status,
  case
    when i.emailed_at is not null and i.email_error is null then 'sent'
    when i.email_error is not null then 'failed'
    else 'not_sent'
  end as email_status
from public.invoices i
join public.quotes q on q.id = i.quote_id
join public.clients c on c.id = q.client_id
left join public.contracts ct on ct.id = q.contract_id
left join lateral (
  select sum(p.amount) as paid_amount
  from public.invoice_payments p
  where p.invoice_id = i.id
) pay on true;

comment on view public.invoice_overview is
  'One row per invoice or credit note (issues #234-#236) with client/quote/contract context, paid_amount, outstanding, payment_status (credit_note | credited | paid | overdue | partially_paid | open, overdue measured against the Europe/Amsterdam date) and email_status (sent | failed | not_sent, from emailed_at/email_error). security_invoker: RLS of invoices/invoice_payments applies, so only owner/finance/administratie see rows.';

revoke all on public.invoice_overview from authenticated;
revoke all on public.invoice_overview from anon;
grant select on public.invoice_overview to authenticated;
