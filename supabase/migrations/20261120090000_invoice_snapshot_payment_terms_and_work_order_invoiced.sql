-- Invoices become immutable documents (issues #227, #232) and invoicing a
-- work order's quote moves the work order to Invoiced (issue #233).
--
-- Until now an invoice row only held its number and quote_id; the PDF, the
-- amounts, the VAT (read live from articles.vat_rate_item_id), the addresses
-- and the due date (hardcoded generated_at + 30 days) were re-computed from
-- live data on every open. Changing an article's VAT rate, a client address
-- or the quote's lines after invoicing silently changed an invoice that had
-- already been sent. This migration:
--
-- A. invoice_settings: per-organization default payment term (days, default
--    30). owner/administratie, same boundary as invoice_email_settings.
-- B. clients.payment_term_days: optional per-client override.
-- C. invoices: snapshot columns (dates, payment term, totals, VAT breakdown,
--    currency, references, notes, recipient/sender). Filled once, at creation.
-- D. invoice_lines: per-line snapshot (incl. the VAT percentage at invoicing
--    time). Read-only for owner/administratie; written only by snapshot_invoice.
-- E. snapshot_invoice(): internal SECURITY DEFINER helper (no grant) that
--    fills C + D from the quote. Money rules: line_total =
--    round(quantity * unit_price * (1 - discount/100), 2); subtotal = sum of
--    the rounded lines (so the printed lines add up to the subtotal); VAT per
--    rate = round(sum(line_total of that rate) * rate / 100, 2).
-- F. create_invoice(quote_id): the ONLY way to create an invoice (direct
--    INSERT grant revoked). Checks role, quote state and company setup, locks
--    the quote row, mints the number, inserts, snapshots - one transaction.
-- G. quote_line_items of an invoiced quote are locked (no insert/update/delete).
-- H. invoices.pdf_path may be set once (null -> canonical path); the stored
--    PDF in the private `invoices` bucket can no longer be overwritten/deleted.
-- I. Work order -> Invoiced when its quote is invoiced (only from Completed).
-- J. Backfill: snapshot every existing invoice (payment term 30, the legacy
--    rule) and move completed work orders of invoiced quotes to Invoiced.

-- ===========================================================================
-- A. invoice_settings
-- ===========================================================================
create table public.invoice_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  payment_term_days integer not null default 30,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_settings_payment_term_days_range check (payment_term_days between 0 and 365)
);

comment on table public.invoice_settings is
  'Per-organization invoicing settings (issue #232): default payment term in days. One row per organization; no row = defaults (30 days). owner/administratie only, same boundary as invoices and invoice_email_settings.';

create index invoice_settings_created_by_idx on public.invoice_settings (created_by);

alter table public.invoice_settings enable row level security;
alter table public.invoice_settings force row level security;

create trigger invoice_settings_set_created_by
  before insert on public.invoice_settings
  for each row execute function public.set_created_by();

create trigger invoice_settings_set_updated_at
  before update on public.invoice_settings
  for each row execute function public.set_updated_at();

create policy "invoice_settings_select_owner_or_administratie"
on public.invoice_settings
for select
to authenticated
using (public.current_member_role(organization_id) in ('owner', 'administratie'));

create policy "invoice_settings_insert_owner_or_administratie"
on public.invoice_settings
for insert
to authenticated
with check (public.current_member_role(organization_id) in ('owner', 'administratie'));

create policy "invoice_settings_update_owner_or_administratie"
on public.invoice_settings
for update
to authenticated
using (public.current_member_role(organization_id) in ('owner', 'administratie'))
with check (public.current_member_role(organization_id) in ('owner', 'administratie'));

revoke all on public.invoice_settings from authenticated;
revoke all on public.invoice_settings from anon;
grant select on public.invoice_settings to authenticated;
grant insert (organization_id, payment_term_days) on public.invoice_settings to authenticated;
grant update (payment_term_days) on public.invoice_settings to authenticated;

-- ===========================================================================
-- B. clients.payment_term_days
-- ===========================================================================
alter table public.clients
  add column payment_term_days integer,
  add constraint clients_payment_term_days_range
    check (payment_term_days is null or payment_term_days between 0 and 365);

comment on column public.clients.payment_term_days is
  'Optional payment term in days for invoices to this client (issue #232). Null = the organization default (invoice_settings.payment_term_days, else 30).';

-- Column grants are additive: the existing INSERT/UPDATE column lists stay.
grant insert (payment_term_days), update (payment_term_days) on public.clients to authenticated;

-- ===========================================================================
-- C. invoices snapshot columns
-- ===========================================================================
alter table public.invoices
  add column invoice_date date,
  add column due_date date,
  add column payment_term_days integer,
  add column currency text not null default 'EUR',
  add column subtotal numeric(12, 2),
  add column vat_total numeric(12, 2),
  add column total numeric(12, 2),
  add column vat_breakdown jsonb not null default '[]'::jsonb,
  add column reference text,
  add column work_order_reference text,
  add column notes text,
  add column recipient jsonb,
  add column sender jsonb,
  add constraint invoices_currency_eur check (currency = 'EUR');

comment on column public.invoices.invoice_date is 'Invoice date (Europe/Amsterdam date of generated_at). Snapshot, issue #232.';
comment on column public.invoices.due_date is 'invoice_date + payment_term_days. Snapshot, issue #232.';
comment on column public.invoices.payment_term_days is 'Payment term used: client override, else invoice_settings, else 30. Snapshot, issue #232.';
comment on column public.invoices.currency is 'Always EUR (the app supports no other currency).';
comment on column public.invoices.subtotal is 'Sum of invoice_lines.line_total (excl. VAT). Snapshot, issue #232.';
comment on column public.invoices.vat_total is 'Sum of vat_breakdown amounts. Snapshot, issue #232.';
comment on column public.invoices.total is 'subtotal + vat_total. Snapshot, issue #232.';
comment on column public.invoices.vat_breakdown is 'Array of {vat_percent, base, amount}, highest rate first. Snapshot, issue #232.';
comment on column public.invoices.reference is 'Reference printed on the invoice: "Contract <number> — <external ref>" for contract quotes, else the quote name.';
comment on column public.invoices.work_order_reference is 'Source work order label ("WO100 · <external ref>"), when the quote came from a work order.';
comment on column public.invoices.notes is 'The quote notes at invoicing time.';
comment on column public.invoices.recipient is 'Client at invoicing time: {name, vat_number, address{line1,line2,postal_code,city,country}}.';
comment on column public.invoices.sender is 'Own company (organizations.own_client_id) at invoicing time: {name, kvk_number, vat_number, iban, logo_path, address{...}}.';
comment on column public.invoices.pdf_path is
  'Storage path of the stored PDF in the private invoices bucket: {organization_id}/{quote_id}/{invoice_number}.pdf. Set once after the first render (issue #227); the stored PDF is what is opened and e-mailed from then on.';

-- ===========================================================================
-- D. invoice_lines
-- ===========================================================================
create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  sort_order integer not null,
  article_number text,
  description text not null,
  asset_label text,
  quantity numeric(10, 2) not null,
  unit_price numeric(12, 2) not null,
  discount_percent numeric(5, 2) not null default 0,
  vat_percent numeric(5, 2) not null default 0,
  line_total numeric(12, 2) not null,
  created_at timestamptz not null default now(),
  unique (invoice_id, sort_order)
);

comment on table public.invoice_lines is
  'Snapshot of an invoice''s lines at invoicing time (issue #232), incl. the VAT percentage then in force. Written only by snapshot_invoice() (SECURITY DEFINER); never updated or deleted. Read: owner/administratie (same as invoices).';

create index invoice_lines_organization_id_idx on public.invoice_lines (organization_id);

alter table public.invoice_lines enable row level security;
alter table public.invoice_lines force row level security;

create policy "invoice_lines_select_owner_or_administratie"
on public.invoice_lines
for select
to authenticated
using (public.current_member_role(organization_id) in ('owner', 'administratie'));

revoke all on public.invoice_lines from authenticated;
revoke all on public.invoice_lines from anon;
grant select on public.invoice_lines to authenticated;

-- ===========================================================================
-- E. snapshot_invoice (internal)
-- ===========================================================================
create or replace function public.invoice_client_address(p_client_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  -- Same choice as the PDF has always made: the client's invoice-address site,
  -- else its primary site, else the first by address.
  select jsonb_build_object(
    'line1', s.address_line1,
    'line2', s.address_line2,
    'postal_code', s.postal_code,
    'city', s.city,
    'country', s.country
  )
  from public.sites s
  where s.client_id = p_client_id
  order by s.is_invoice_address desc, s.is_primary desc, s.address_line1 asc nulls last
  limit 1;
$$;

comment on function public.invoice_client_address(uuid) is
  'Internal (no grant): a client''s address for an invoice snapshot — invoice-address site, else primary, else first by address. Null when the client has no sites.';

revoke all on function public.invoice_client_address(uuid) from public;
revoke all on function public.invoice_client_address(uuid) from anon;
revoke all on function public.invoice_client_address(uuid) from authenticated;

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
    c.name as client_name, c.vat_number as client_vat_number, c.payment_term_days as client_term,
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
  'Internal (no grant): fills invoices snapshot columns and invoice_lines from the invoice''s quote, once. Called by create_invoice() and the backfill in 20261120090000. p_payment_term_days overrides the client/organization term (backfill uses 30, the legacy rule).';

revoke all on function public.snapshot_invoice(uuid, integer) from public;
revoke all on function public.snapshot_invoice(uuid, integer) from anon;
revoke all on function public.snapshot_invoice(uuid, integer) from authenticated;

-- ===========================================================================
-- F. create_invoice: the only way to create an invoice
-- ===========================================================================
create or replace function public.create_invoice(p_quote_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote public.quotes%rowtype;
  v_role public.membership_role;
  v_status text;
  v_number text;
  v_invoice_id uuid;
begin
  -- Row lock: two concurrent "Generate invoice" clicks serialize here.
  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'Quote not found, or you do not have permission to view it.' using errcode = 'P0002';
  end if;

  v_role := public.current_member_role(v_quote.organization_id);
  if v_role is distinct from 'owner' and v_role is distinct from 'administratie' then
    raise exception 'Only an owner or administratie member can generate invoices.' using errcode = '42501';
  end if;

  if exists (select 1 from public.invoices where quote_id = p_quote_id) then
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
  'Creates the invoice for a quote (issues #119/#211/#232): owner/administratie only; refuses auto-draft, already-invoiced, rejected/expired, line-less quotes and organizations without own company details. Mints the number, inserts (existing AFTER INSERT triggers set the quote/contract/work order state) and snapshots amounts, lines, dates and addresses. The direct INSERT grant on invoices is revoked: this is the only way in.';

revoke all on function public.create_invoice(uuid) from public;
revoke all on function public.create_invoice(uuid) from anon;
grant execute on function public.create_invoice(uuid) to authenticated;

revoke insert on public.invoices from authenticated;

-- ===========================================================================
-- G. Lock the lines of an invoiced quote
-- ===========================================================================
create or replace function public.guard_invoiced_quote_line_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE')
     and exists (select 1 from public.invoices where quote_id = old.quote_id) then
    raise exception 'This quote has been invoiced; its line items can no longer be changed.' using errcode = '23514';
  end if;
  if tg_op in ('INSERT', 'UPDATE')
     and exists (select 1 from public.invoices where quote_id = new.quote_id) then
    raise exception 'This quote has been invoiced; its line items can no longer be changed.' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

comment on function public.guard_invoiced_quote_line_items() is
  'BEFORE INSERT/UPDATE/DELETE trigger on quote_line_items (issue #232): an invoiced quote''s lines are frozen, so the quote keeps matching its invoice.';

create trigger quote_line_items_guard_invoiced
  before insert or update or delete on public.quote_line_items
  for each row execute function public.guard_invoiced_quote_line_items();

-- ===========================================================================
-- H. pdf_path once; stored PDFs immutable
-- ===========================================================================
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
  return new;
end;
$$;

comment on function public.guard_invoice_update() is
  'BEFORE UPDATE trigger on invoices (issue #227): pdf_path may only go from null to the canonical {organization_id}/{quote_id}/{invoice_number}.pdf, once.';

create trigger invoices_guard_update
  before update on public.invoices
  for each row execute function public.guard_invoice_update();

grant update (pdf_path) on public.invoices to authenticated;

drop policy if exists "invoices_bucket_update_owner_or_administratie" on storage.objects;
drop policy if exists "invoices_bucket_delete_owner_or_administratie" on storage.objects;

-- ===========================================================================
-- I. Work order -> Invoiced
-- ===========================================================================
create or replace function public.set_work_order_invoiced_on_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_work_order_id uuid;
  v_invoiced_id uuid;
begin
  select q.work_order_id into v_work_order_id from public.quotes q where q.id = new.quote_id;
  if v_work_order_id is null then
    return null;
  end if;

  select rli.id into v_invoiced_id
  from public.reference_list_items rli
  join public.reference_lists rl on rl.id = rli.reference_list_id
  where rl.organization_id = new.organization_id
    and rl.list_key = 'work_order_status'
    and rli.value = 'invoiced'
  limit 1;
  if v_invoiced_id is null then
    return null;
  end if;

  update public.work_orders wo
  set status_id = v_invoiced_id
  from public.reference_list_items cur
  where wo.id = v_work_order_id
    and cur.id = wo.status_id
    and cur.value = 'completed';

  return null;
end;
$$;

comment on function public.set_work_order_invoiced_on_invoice() is
  'AFTER INSERT trigger on invoices (issue #233): when the invoiced quote came from a work order (quotes.work_order_id) and that work order is Completed, set it to the org''s work_order_status ''invoiced'' item. Other statuses are left alone.';

create trigger invoices_set_work_order_invoiced
  after insert on public.invoices
  for each row execute function public.set_work_order_invoiced_on_invoice();

-- ===========================================================================
-- J. Backfill
-- ===========================================================================
do $$
declare
  r record;
begin
  for r in
    select i.id from public.invoices i
    where not exists (select 1 from public.invoice_lines l where l.invoice_id = i.id)
    order by i.generated_at
  loop
    perform public.snapshot_invoice(r.id, 30);
  end loop;
end;
$$;

update public.work_orders wo
set status_id = inv_status.id
from public.quotes q
join public.invoices i on i.quote_id = q.id
join public.reference_lists rl on rl.organization_id = q.organization_id and rl.list_key = 'work_order_status'
join public.reference_list_items inv_status on inv_status.reference_list_id = rl.id and inv_status.value = 'invoiced',
public.reference_list_items cur
where q.work_order_id = wo.id
  and cur.id = wo.status_id
  and cur.value = 'completed';

alter table public.invoices
  alter column invoice_date set not null,
  alter column due_date set not null,
  alter column payment_term_days set not null,
  alter column subtotal set not null,
  alter column vat_total set not null,
  alter column total set not null,
  alter column recipient set not null;
