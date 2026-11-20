-- E-mail outbox hardening (follow-up to 20261122110000_email_outbox.sql, QA review of #268).
--
--  1. prepare_email_outbox_insert: the attachment must be the source's stored PDF
--     (the service-role processor downloads attachment_path and mails it, so a
--     free-form path was a cross-tenant read primitive).
--  2. from_address must be the org's configured sender (invoice_email_settings /
--     work_receipt_email_settings), derivable in SQL, so it is validated there.
--  3. "source not found" and "not allowed" are indistinguishable (42501), and the
--     role check now runs before any other check so foreign ids can't be probed.
--  4. Global processor lease: only one processor at a time.

-- ===========================================================================
-- 1-3. Insert trigger
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
  v_pdf_path text;
  v_allowed boolean;
  v_sender text;
  v_mailbox text;
begin
  if new.invoice_id is not null then
    select organization_id, kind, pdf_path into v_org, v_invoice_kind, v_pdf_path
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
  'BEFORE INSERT trigger on email_outbox: derives organization_id from the source, enforces the insert role (42501, identical for unknown and foreign sources), checks kind against invoices.kind, requires attachment_path = the source''s stored pdf_path, requires from_address to be a single mailbox equal to the org''s configured from_email (invoice_email_settings / work_receipt_email_settings), stamps queued_by = auth.uid().';

-- ===========================================================================
-- 4. Global processor lease
-- ===========================================================================
create table public.email_outbox_processor_lease (
  id boolean primary key default true check (id),
  holder uuid,
  expires_at timestamptz not null
);

comment on table public.email_outbox_processor_lease is
  'Single-row lease so only one outbox processor runs at a time (advisory locks do not survive PostgREST calls). Not tenant data; only reachable via the service_role lease functions.';

alter table public.email_outbox_processor_lease enable row level security;
alter table public.email_outbox_processor_lease force row level security;
revoke all on public.email_outbox_processor_lease from public, anon, authenticated;

create or replace function public.acquire_email_outbox_lease(p_holder uuid, p_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  insert into public.email_outbox_processor_lease as l (id, holder, expires_at)
  values (true, p_holder, now() + make_interval(secs => greatest(coalesce(p_seconds, 1), 1)))
  on conflict (id) do update
    set holder = excluded.holder, expires_at = excluded.expires_at
    where l.holder is not distinct from p_holder or l.expires_at <= now();
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

comment on function public.acquire_email_outbox_lease(uuid, integer) is
  'Takes the global processor lease for p_seconds when it is free, expired or already held by p_holder (renew). Returns false when another holder has it. service_role only.';

create or replace function public.release_email_outbox_lease(p_holder uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.email_outbox_processor_lease where holder = p_holder;
$$;

comment on function public.release_email_outbox_lease(uuid) is
  'Releases the processor lease if (and only if) p_holder holds it. service_role only.';

revoke all on function public.acquire_email_outbox_lease(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_email_outbox_lease(uuid) from public, anon, authenticated;
grant execute on function public.acquire_email_outbox_lease(uuid, integer) to service_role;
grant execute on function public.release_email_outbox_lease(uuid) to service_role;
