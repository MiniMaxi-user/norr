-- E-mail outbox (issue #268).
--
-- Outgoing mails (invoice, credit note, work receipt) are queued here instead
-- of being sent synchronously. A processor (Next.js `after()` + a cron route)
-- claims rows, sends them via the mail provider with throttling and retry, and
-- records the outcome here and on the source row (emailed_to/emailed_at/
-- email_error on invoices / work_receipts).
--
-- Security model:
--  * Members SELECT/INSERT under their own session; RLS mirrors the rights on
--    the source record (invoice + credit_note: is_invoicing_member; work_receipt:
--    select owner/planner/finance/administratie, insert owner/planner/administratie).
--  * authenticated has NO UPDATE/DELETE grant and INSERT only on the content
--    columns: status, attempts, provider_message_id, sent_at, queued_by,
--    organization_id can never be set from a client. A trigger derives
--    organization_id from the source and stamps queued_by = auth.uid().
--  * "Retry" is retry_email_outbox() (SECURITY DEFINER, same rights as insert).
--  * claim_email_outbox / complete_email_outbox / email_outbox_sent_count
--    are granted to service_role ONLY. The service-role client is used solely
--    by the server-side processor (no user session available in `after()` / cron),
--    never from client code, so CLAUDE.md rule 1 still holds.

-- ===========================================================================
-- A. Table
-- ===========================================================================
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('invoice', 'credit_note', 'work_receipt')),
  invoice_id uuid references public.invoices (id) on delete cascade,
  work_receipt_id uuid references public.work_receipts (id) on delete cascade,
  to_addresses text[] not null check (cardinality(to_addresses) >= 1),
  cc_addresses text[] not null default '{}',
  from_address text not null,
  subject text not null,
  body_text text not null,
  body_html text,
  attachment_path text,
  attachment_filename text,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  provider_message_id text,
  queued_by uuid references public.users (id) on delete set null,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint email_outbox_source_matches_kind check (
    (kind in ('invoice', 'credit_note') and invoice_id is not null and work_receipt_id is null)
    or (kind = 'work_receipt' and work_receipt_id is not null and invoice_id is null)
  ),
  constraint email_outbox_attachment_pair check ((attachment_path is null) = (attachment_filename is null))
);

comment on table public.email_outbox is
  'Outgoing e-mail queue (issue #268) for invoices, credit notes and work receipts. One row per mail. Attachment = storage path of the stored PDF (invoices / work-receipts bucket by kind), never bytes. Clients can only INSERT content columns and SELECT; status transitions run through retry_email_outbox() (users) and claim_/complete_email_outbox() (service_role, server-side processor only).';
comment on column public.email_outbox.status is 'queued -> sending (claimed, attempts+1) -> sent | failed | back to queued (retry with next_attempt_at). Rows in sending for >10 minutes are reclaimable.';
comment on column public.email_outbox.attachment_path is 'Path in the private bucket of the source: invoices (kind invoice/credit_note) or work-receipts (kind work_receipt).';
comment on column public.email_outbox.queued_by is 'Stamped from auth.uid() by trigger on insert.';

create index email_outbox_organization_id_idx on public.email_outbox (organization_id, queued_at desc);
create index email_outbox_invoice_id_idx on public.email_outbox (invoice_id) where invoice_id is not null;
create index email_outbox_work_receipt_id_idx on public.email_outbox (work_receipt_id) where work_receipt_id is not null;
create index email_outbox_queued_by_idx on public.email_outbox (queued_by);
create index email_outbox_processor_idx on public.email_outbox (status, next_attempt_at)
  where status in ('queued', 'sending');
create index email_outbox_sent_at_idx on public.email_outbox (sent_at) where status = 'sent';

alter table public.email_outbox enable row level security;
alter table public.email_outbox force row level security;

-- ===========================================================================
-- B. Triggers
-- ===========================================================================
create or replace function public.prepare_email_outbox_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_invoice_kind text;
begin
  if new.invoice_id is not null then
    select organization_id, kind into v_org, v_invoice_kind from public.invoices where id = new.invoice_id;
    if v_org is null then
      raise exception 'email_outbox: invoice not found' using errcode = '23503';
    end if;
    if new.kind is distinct from v_invoice_kind then
      raise exception 'email_outbox: kind % does not match the invoice (%)', new.kind, v_invoice_kind
        using errcode = '23514';
    end if;
  elsif new.work_receipt_id is not null then
    select organization_id into v_org from public.work_receipts where id = new.work_receipt_id;
    if v_org is null then
      raise exception 'email_outbox: work receipt not found' using errcode = '23503';
    end if;
  else
    raise exception 'email_outbox: a source record is required' using errcode = '23514';
  end if;

  new.organization_id := v_org;
  new.queued_by := auth.uid();
  return new;
end;
$$;

comment on function public.prepare_email_outbox_insert() is
  'BEFORE INSERT trigger on email_outbox: derives organization_id from the source invoice/work receipt, checks kind against invoices.kind, stamps queued_by = auth.uid().';

revoke all on function public.prepare_email_outbox_insert() from public, anon, authenticated;

create trigger email_outbox_prepare_insert
  before insert on public.email_outbox
  for each row execute function public.prepare_email_outbox_insert();

create or replace function public.touch_email_outbox_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger email_outbox_touch_updated_at
  before update on public.email_outbox
  for each row execute function public.touch_email_outbox_updated_at();

-- ===========================================================================
-- C. RLS + grants
-- ===========================================================================
create policy "email_outbox_select"
on public.email_outbox for select to authenticated
using (
  case
    when kind in ('invoice', 'credit_note') then public.is_invoicing_member(organization_id)
    else public.current_member_role(organization_id) in ('owner', 'planner', 'finance', 'administratie')
  end
);

create policy "email_outbox_insert"
on public.email_outbox for insert to authenticated
with check (
  case
    when kind in ('invoice', 'credit_note') then public.is_invoicing_member(organization_id)
    else public.current_member_role(organization_id) in ('owner', 'planner', 'administratie')
  end
);

revoke all on public.email_outbox from authenticated;
revoke all on public.email_outbox from anon;
grant select on public.email_outbox to authenticated;
grant insert (kind, invoice_id, work_receipt_id, to_addresses, cc_addresses, from_address, subject,
              body_text, body_html, attachment_path, attachment_filename)
  on public.email_outbox to authenticated;

-- ===========================================================================
-- D. retry_email_outbox (users)
-- ===========================================================================
create or replace function public.retry_email_outbox(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.email_outbox%rowtype;
  v_allowed boolean;
begin
  select * into v_row from public.email_outbox where id = p_id for update;
  if not found then
    raise exception 'email_outbox: not found' using errcode = 'P0002';
  end if;

  if v_row.kind in ('invoice', 'credit_note') then
    v_allowed := public.is_invoicing_member(v_row.organization_id);
  else
    v_allowed := public.current_member_role(v_row.organization_id) in ('owner', 'planner', 'administratie');
  end if;
  if not coalesce(v_allowed, false) then
    raise exception 'email_outbox: not allowed' using errcode = '42501';
  end if;

  if v_row.status <> 'failed' then
    raise exception 'email_outbox: only failed mails can be retried' using errcode = '55000';
  end if;

  update public.email_outbox
  set status = 'queued', attempts = 0, next_attempt_at = now(), last_error = null
  where id = p_id;
end;
$$;

comment on function public.retry_email_outbox(uuid) is
  'Resets a failed outbox mail to queued (attempts 0, next_attempt_at now). Same role rights as inserting that kind; 42501 otherwise, 55000 when not failed, P0002 when unknown.';

revoke all on function public.retry_email_outbox(uuid) from public, anon;
grant execute on function public.retry_email_outbox(uuid) to authenticated;

-- ===========================================================================
-- E. Processor functions (service_role only)
-- ===========================================================================
create or replace function public.claim_email_outbox(p_limit integer)
returns setof public.email_outbox
language sql
security definer
set search_path = public
as $$
  update public.email_outbox o
  set status = 'sending', attempts = o.attempts + 1
  where o.id in (
    select c.id
    from public.email_outbox c
    where (c.status = 'queued' and c.next_attempt_at <= now())
       or (c.status = 'sending' and c.updated_at < now() - interval '10 minutes')
    order by c.next_attempt_at
    for update skip locked
    limit greatest(coalesce(p_limit, 0), 0)
  )
  returning o.*;
$$;

comment on function public.claim_email_outbox(integer) is
  'Atomically claims up to p_limit due mails (queued and due, or stuck in sending for >10 minutes): sets status sending and attempts+1, using FOR UPDATE SKIP LOCKED so concurrent processors never claim the same row. service_role only (server-side processor).';

-- emailed_by: the processor has no auth.uid(), so the actor comes from the
-- norr.email_actor setting (set by complete_email_outbox to the queuing user).
create or replace function public.guard_work_receipt_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.work_order_id is distinct from old.work_order_id
     or new.version is distinct from old.version
     or new.receipt_number is distinct from old.receipt_number
     or new.generated_at is distinct from old.generated_at
     or new.generated_by is distinct from old.generated_by
     or new.emailed_by is distinct from old.emailed_by then
    raise exception 'work_receipts: only pdf_path and the e-mail log columns can be updated'
      using errcode = '23514';
  end if;

  if new.pdf_path is distinct from old.pdf_path then
    if old.pdf_path is not null then
      raise exception 'work_receipts.pdf_path is already set' using errcode = '23514';
    end if;
    if new.pdf_path is distinct from
       (new.organization_id::text || '/' || new.work_order_id::text || '/' || new.receipt_number || '.pdf') then
      raise exception 'work_receipts.pdf_path must be {organization_id}/{work_order_id}/{receipt_number}.pdf'
        using errcode = '23514';
    end if;
  end if;

  if new.emailed_to is distinct from old.emailed_to
     or new.emailed_at is distinct from old.emailed_at
     or new.email_error is distinct from old.email_error then
    new.emailed_by := coalesce(auth.uid(), nullif(current_setting('norr.email_actor', true), '')::uuid);
  end if;
  return new;
end;
$$;

comment on function public.guard_work_receipt_update() is
  'BEFORE UPDATE trigger on work_receipts: only pdf_path (null -> canonical path, once) and emailed_to/emailed_at/email_error may change; stamps emailed_by from auth.uid(), or from the norr.email_actor setting when the outbox processor (no session) records the outcome.';

create or replace function public.complete_email_outbox(
  p_id uuid,
  p_ok boolean,
  p_provider_message_id text default null,
  p_error text default null,
  p_retry_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.email_outbox%rowtype;
  v_status text;
  v_to text;
begin
  select * into v_row from public.email_outbox where id = p_id for update;
  if not found then
    raise exception 'email_outbox: not found' using errcode = 'P0002';
  end if;
  if v_row.status <> 'sending' then
    -- Already completed (or reclaimed) elsewhere: stay idempotent.
    return;
  end if;

  if p_ok then
    v_status := 'sent';
  elsif p_retry_at is not null then
    v_status := 'queued';
  else
    v_status := 'failed';
  end if;

  update public.email_outbox
  set status = v_status,
      provider_message_id = case when p_ok then p_provider_message_id else provider_message_id end,
      sent_at = case when p_ok then now() else sent_at end,
      last_error = case when p_ok then null else p_error end,
      next_attempt_at = case when v_status = 'queued' then p_retry_at else next_attempt_at end
  where id = p_id;

  -- Source trail only on a final outcome (sent / definitively failed).
  if v_status in ('sent', 'failed') then
    v_to := array_to_string(v_row.to_addresses, ', ');
    perform set_config('norr.email_actor', coalesce(v_row.queued_by::text, ''), true);

    if v_row.invoice_id is not null then
      if v_status = 'sent' then
        update public.invoices set emailed_to = v_to, emailed_at = now(), email_error = null
        where id = v_row.invoice_id;
      else
        update public.invoices set email_error = coalesce(p_error, 'E-mail could not be sent')
        where id = v_row.invoice_id;
      end if;
    elsif v_row.work_receipt_id is not null then
      if v_status = 'sent' then
        update public.work_receipts set emailed_to = v_to, emailed_at = now(), email_error = null
        where id = v_row.work_receipt_id;
      else
        update public.work_receipts set emailed_to = v_to, email_error = coalesce(p_error, 'E-mail could not be sent')
        where id = v_row.work_receipt_id;
      end if;
    end if;
  end if;
end;
$$;

comment on function public.complete_email_outbox(uuid, boolean, text, text, timestamptz) is
  'Records a send attempt on a claimed (sending) mail: p_ok -> sent (+ provider id, sent_at); not ok with p_retry_at -> back to queued at p_retry_at; not ok without -> failed. On sent/failed also updates emailed_to/emailed_at/email_error on the source invoice / work receipt (work receipts keep their existing semantics: emailed_to = recipient of the last attempt). No-op when the row is no longer sending. service_role only.';

create or replace function public.email_outbox_sent_count(p_since timestamptz)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.email_outbox where status = 'sent' and sent_at >= p_since;
$$;

comment on function public.email_outbox_sent_count(timestamptz) is
  'Number of mails sent since p_since across ALL organizations (the provider limit is per account). For processor throttling; service_role only.';

revoke all on function public.claim_email_outbox(integer) from public, anon, authenticated;
revoke all on function public.complete_email_outbox(uuid, boolean, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.email_outbox_sent_count(timestamptz) from public, anon, authenticated;
grant execute on function public.claim_email_outbox(integer) to service_role;
grant execute on function public.complete_email_outbox(uuid, boolean, text, text, timestamptz) to service_role;
grant execute on function public.email_outbox_sent_count(timestamptz) to service_role;
