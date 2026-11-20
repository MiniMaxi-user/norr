-- UBL e-invoice + CSV export (issue #241), database part.
--
--  1. clients.ubl_email_enabled: per-client "attach UBL e-invoice to invoice e-mails".
--  2. invoice_email_settings.attach_ubl: organization master switch.
--  3. invoices.recipient gains kvk_number (new invoices via snapshot_invoice();
--     credit notes copy the original's recipient, so they inherit it). Existing
--     rows are backfilled once from the current client.
--  4. invoices.ubl_path: set once (null -> {org}/{quote_id}/{invoice_number}.xml),
--     same pattern, grant and RLS as pdf_path. The `invoices` bucket has no
--     mime restriction and its insert policy is path-based, so .xml uploads work
--     for the same roles (is_invoicing_member) that upload the PDF.
--  5. email_outbox.extra_attachment_path/_filename (both or neither); the insert
--     trigger requires the path to equal the source invoice's ubl_path.

-- ===========================================================================
-- 1. clients.ubl_email_enabled
-- ===========================================================================
alter table public.clients
  add column ubl_email_enabled boolean not null default false;

comment on column public.clients.ubl_email_enabled is
  'When true (and invoice_email_settings.attach_ubl is on) invoice e-mails to this client carry the UBL e-invoice XML as a second attachment (issue #241). Same RLS/grants as the other client columns (owner writes).';

grant insert (ubl_email_enabled), update (ubl_email_enabled) on public.clients to authenticated;

-- ===========================================================================
-- 2. invoice_email_settings.attach_ubl
-- ===========================================================================
alter table public.invoice_email_settings
  add column attach_ubl boolean not null default true;

comment on column public.invoice_email_settings.attach_ubl is
  'Organization master switch (issue #241): attach the UBL e-invoice to invoice e-mails for clients that have clients.ubl_email_enabled.';

grant insert (attach_ubl), update (attach_ubl) on public.invoice_email_settings to authenticated;

-- ===========================================================================
-- 3. Recipient snapshot with kvk_number
-- ===========================================================================
create or replace function public.snapshot_invoice(p_invoice_id uuid, p_payment_term_days integer default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_quote record;
  v_own_client record;
  v_term integer;
  v_invoice_date date;
  v_subtotal numeric(12, 2);
  v_vat_total numeric(12, 2);
  v_breakdown jsonb;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id;
  if not found then
    raise exception 'Invoice % not found', p_invoice_id using errcode = 'P0002';
  end if;
  if exists (select 1 from public.invoice_lines where invoice_id = p_invoice_id) then
    raise exception 'Invoice % has already been snapshotted', v_invoice.invoice_number using errcode = '23514';
  end if;

  select
    q.name, q.notes, q.quote_type, q.client_id,
    c.name as client_name, c.kvk_number as client_kvk_number, c.vat_number as client_vat_number,
    c.payment_term_days as client_term,
    ct.contract_number, ct.external_reference as contract_external_reference,
    wo.work_order_number, wo.external_reference as work_order_external_reference
  into v_quote
  from public.quotes q
  join public.clients c on c.id = q.client_id
  left join public.contracts ct on ct.id = q.contract_id
  left join public.work_orders wo on wo.id = q.work_order_id
  where q.id = v_invoice.quote_id;

  select c.id, c.name, c.kvk_number, c.vat_number, c.iban, c.logo_path
  into v_own_client
  from public.organizations o
  join public.clients c on c.id = o.own_client_id
  where o.id = v_invoice.organization_id;

  v_term := coalesce(
    p_payment_term_days,
    v_quote.client_term,
    (select s.payment_term_days from public.invoice_settings s where s.organization_id = v_invoice.organization_id),
    30
  );
  v_invoice_date := (v_invoice.generated_at at time zone 'Europe/Amsterdam')::date;

  insert into public.invoice_lines (
    organization_id, invoice_id, sort_order, article_number, description, asset_label,
    quantity, unit_price, discount_percent, vat_percent, line_total
  )
  select
    v_invoice.organization_id,
    p_invoice_id,
    row_number() over (order by qli.sort_order, qli.created_at, qli.id),
    coalesce(qli.article_number, a.article_number),
    qli.description,
    nullif(concat_ws(' / ', ast.serial_number, am.name), ''),
    qli.quantity,
    qli.unit_price,
    qli.discount_percent,
    case when vr.value ~ '^[0-9]+([.][0-9]+)?$' then vr.value::numeric else 0 end,
    round(qli.quantity * qli.unit_price * (1 - qli.discount_percent / 100), 2)
  from public.quote_line_items qli
  left join public.articles a on a.id = qli.article_id
  left join public.reference_list_items vr on vr.id = a.vat_rate_item_id
  left join public.assets ast on ast.id = qli.asset_id
  left join public.asset_models am on am.id = ast.model_id
  where qli.quote_id = v_invoice.quote_id;

  select coalesce(sum(l.line_total), 0) into v_subtotal
  from public.invoice_lines l
  where l.invoice_id = p_invoice_id;

  select coalesce(
    jsonb_agg(jsonb_build_object('vat_percent', b.vat_percent, 'base', b.base, 'amount', b.amount) order by b.vat_percent desc),
    '[]'::jsonb
  )
  into v_breakdown
  from (
    select l.vat_percent, sum(l.line_total) as base, round(sum(l.line_total) * l.vat_percent / 100, 2) as amount
    from public.invoice_lines l
    where l.invoice_id = p_invoice_id
    group by l.vat_percent
  ) b;

  select coalesce(sum((e ->> 'amount')::numeric), 0) into v_vat_total
  from jsonb_array_elements(v_breakdown) e;

  update public.invoices
  set
    invoice_date = v_invoice_date,
    payment_term_days = v_term,
    due_date = v_invoice_date + v_term,
    subtotal = v_subtotal,
    vat_total = v_vat_total,
    total = v_subtotal + v_vat_total,
    vat_breakdown = v_breakdown,
    reference = case
      when v_quote.quote_type = 'contract' and v_quote.contract_number is not null
        then 'Contract ' || v_quote.contract_number
             || coalesce(' — ' || nullif(v_quote.contract_external_reference, ''), '')
      else v_quote.name
    end,
    work_order_reference = case
      when v_quote.work_order_number is null then null
      else v_quote.work_order_number || coalesce(' · ' || nullif(v_quote.work_order_external_reference, ''), '')
    end,
    notes = v_quote.notes,
    recipient = jsonb_build_object(
      'name', v_quote.client_name,
      'kvk_number', v_quote.client_kvk_number,
      'vat_number', v_quote.client_vat_number,
      'address', public.invoice_client_address(v_quote.client_id)
    ),
    sender = case when v_own_client.id is null then null else jsonb_build_object(
      'name', v_own_client.name,
      'kvk_number', v_own_client.kvk_number,
      'vat_number', v_own_client.vat_number,
      'iban', v_own_client.iban,
      'logo_path', v_own_client.logo_path,
      'address', public.invoice_client_address(v_own_client.id)
    ) end
  where id = p_invoice_id;
end;
$$;

comment on function public.snapshot_invoice(uuid, integer) is
  'Internal (no grant): fills invoices snapshot columns and invoice_lines from the invoice''s quote, once. Called by create_invoice() and the backfill in 20261120090000. p_payment_term_days overrides the client/organization term (backfill uses 30, the legacy rule). Since 20261123090000 the recipient snapshot also carries kvk_number (credit notes copy the original''s recipient).';

revoke all on function public.snapshot_invoice(uuid, integer) from public;
revoke all on function public.snapshot_invoice(uuid, integer) from anon;
revoke all on function public.snapshot_invoice(uuid, integer) from authenticated;

-- One-off backfill from the current client (best available; the original
-- value was not snapshotted). Only the recipient column changes; the only
-- BEFORE UPDATE guard on invoices (guard_invoice_update) looks at
-- pdf_path/ubl_path, so no trigger needs bypassing.
update public.invoices i
set recipient = i.recipient || jsonb_build_object('kvk_number', c.kvk_number)
from public.quotes q
join public.clients c on c.id = q.client_id
where q.id = i.quote_id
  and not (i.recipient ? 'kvk_number');

-- ===========================================================================
-- 4. invoices.ubl_path (set once, like pdf_path)
-- ===========================================================================
alter table public.invoices add column ubl_path text;

comment on column public.invoices.ubl_path is
  'Storage path (bucket invoices) of the stored UBL e-invoice XML (issue #241). Set once, null -> {organization_id}/{quote_id}/{invoice_number}.xml, by the same roles that set pdf_path.';

create or replace function public.guard_invoice_update()
returns trigger
language plpgsql
as $$
begin
  if new.pdf_path is distinct from old.pdf_path then
    if old.pdf_path is not null then
      raise exception 'invoices.pdf_path is already set' using errcode = '23514';
    end if;
    if new.pdf_path is distinct from
       (new.organization_id::text || '/' || new.quote_id::text || '/' || new.invoice_number || '.pdf') then
      raise exception 'invoices.pdf_path must be {organization_id}/{quote_id}/{invoice_number}.pdf' using errcode = '23514';
    end if;
  end if;
  if new.ubl_path is distinct from old.ubl_path then
    if old.ubl_path is not null then
      raise exception 'invoices.ubl_path is already set' using errcode = '23514';
    end if;
    if new.ubl_path is distinct from
       (new.organization_id::text || '/' || new.quote_id::text || '/' || new.invoice_number || '.xml') then
      raise exception 'invoices.ubl_path must be {organization_id}/{quote_id}/{invoice_number}.xml' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.guard_invoice_update() is
  'BEFORE UPDATE trigger on invoices (issues #227, #241): pdf_path may only go from null to the canonical {organization_id}/{quote_id}/{invoice_number}.pdf, once; ubl_path likewise with the .xml extension.';

grant update (ubl_path) on public.invoices to authenticated;

-- ===========================================================================
-- 5. email_outbox extra attachment
-- ===========================================================================
alter table public.email_outbox
  add column extra_attachment_path text,
  add column extra_attachment_filename text,
  add constraint email_outbox_extra_attachment_pair
    check ((extra_attachment_path is null) = (extra_attachment_filename is null));

comment on column public.email_outbox.extra_attachment_path is
  'Optional second attachment (issue #241): the source invoice''s stored UBL XML (invoices.ubl_path) in the invoices bucket. Invoice-kind mails only.';

grant insert (extra_attachment_path, extra_attachment_filename) on public.email_outbox to authenticated;

create or replace function public.prepare_email_outbox_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_invoice_kind text;
  v_pdf_path text;
  v_ubl_path text;
  v_allowed boolean;
  v_sender text;
  v_mailbox text;
begin
  if new.invoice_id is not null then
    select organization_id, kind, pdf_path, ubl_path into v_org, v_invoice_kind, v_pdf_path, v_ubl_path
    from public.invoices where id = new.invoice_id;
  elsif new.work_receipt_id is not null then
    select organization_id, pdf_path into v_org, v_pdf_path
    from public.work_receipts where id = new.work_receipt_id;
  else
    raise exception 'email_outbox: a source record is required' using errcode = '23514';
  end if;

  -- Same error for "does not exist" and "not allowed" (no probing of foreign ids).
  if v_org is not null then
    if new.kind in ('invoice', 'credit_note') then
      v_allowed := public.is_invoicing_member(v_org);
    else
      v_allowed := public.current_member_role(v_org) in ('owner', 'planner', 'administratie');
    end if;
  end if;
  if v_org is null or not coalesce(v_allowed, false) then
    raise exception 'email_outbox: source not found or not allowed' using errcode = '42501';
  end if;

  if new.invoice_id is not null and new.kind is distinct from v_invoice_kind then
    raise exception 'email_outbox: kind % does not match the invoice (%)', new.kind, v_invoice_kind
      using errcode = '23514';
  end if;

  -- Attachment must be exactly the stored PDF of the source record.
  if new.attachment_path is not null
     and (v_pdf_path is null or new.attachment_path is distinct from v_pdf_path) then
    raise exception 'email_outbox: attachment_path must equal the stored PDF of the source record'
      using errcode = '42501';
  end if;

  -- Extra attachment: only the source invoice's stored UBL XML, invoice-kind mails only.
  if new.extra_attachment_path is not null
     and (new.kind is distinct from 'invoice'
          or v_ubl_path is null
          or new.extra_attachment_path is distinct from v_ubl_path) then
    raise exception 'email_outbox: extra_attachment_path must equal the stored UBL file of the source invoice'
      using errcode = '42501';
  end if;

  -- Sender must be the organization's configured one: "email" or "Name <email>".
  if new.kind in ('invoice', 'credit_note') then
    select from_email into v_sender from public.invoice_email_settings where organization_id = v_org;
  else
    select from_email into v_sender from public.work_receipt_email_settings where organization_id = v_org;
  end if;
  if v_sender is null then
    raise exception 'email_outbox: e-mail sender is not configured for this organization'
      using errcode = '23514';
  end if;
  if new.from_address !~ '^([^<>",[:cntrl:]]* <[^<>[:space:]]+>|[^<>",;[:space:]]+)$' then
    raise exception 'email_outbox: from_address must be a single mailbox' using errcode = '23514';
  end if;
  v_mailbox := coalesce(substring(new.from_address from '<([^<>[:space:]]+)>$'), new.from_address);
  if lower(v_mailbox) <> lower(v_sender) then
    raise exception 'email_outbox: from_address must be the configured sender of the organization'
      using errcode = '42501';
  end if;

  new.organization_id := v_org;
  new.queued_by := auth.uid();
  return new;
end;
$$;

comment on function public.prepare_email_outbox_insert() is
  'BEFORE INSERT trigger on email_outbox: derives organization_id from the source, enforces the insert role (42501, identical for unknown and foreign sources), checks kind against invoices.kind, requires attachment_path = the source''s stored pdf_path and (since 20261123090000) extra_attachment_path = the source invoice''s stored ubl_path (kind invoice only), requires from_address to be a single mailbox equal to the org''s configured from_email (invoice_email_settings / work_receipt_email_settings), stamps queued_by = auth.uid().';
