-- Follow-up to 20261123090000 (issue #241): the outbox extra attachment (UBL XML) is also
-- allowed on credit_note mails. A credit-note mail points at the credit note's own invoices
-- row (kind must match invoices.kind), so the rule is unchanged: extra_attachment_path must
-- equal that row's ubl_path. work_receipt mails stay rejected.

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

  -- Extra attachment: only the source invoice row's stored UBL XML, invoice and credit_note mails only.
  if new.extra_attachment_path is not null
     and (new.kind not in ('invoice', 'credit_note')
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
  'BEFORE INSERT trigger on email_outbox: derives organization_id from the source, enforces the insert role (42501, identical for unknown and foreign sources), checks kind against invoices.kind, requires attachment_path = the source''s stored pdf_path and (since 20261123090000) extra_attachment_path = the source invoice''s stored ubl_path (kind invoice or credit_note), requires from_address to be a single mailbox equal to the org''s configured from_email (invoice_email_settings / work_receipt_email_settings), stamps queued_by = auth.uid().';
