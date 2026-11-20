-- Organization switches to turn e-mailing on or off per document type:
--   invoice_email_settings.email_invoices        - invoice e-mails (automatic on invoicing + manual send)
--   invoice_email_settings.email_credit_notes    - credit note e-mails (automatic on crediting + manual send)
--   work_receipt_email_settings.email_work_receipts - work receipt e-mails
-- Default true keeps today's behaviour. Purely additive; RLS unchanged (same row
-- policies as the existing settings columns), only the column grants are extended.

alter table public.invoice_email_settings
  add column email_invoices boolean not null default true,
  add column email_credit_notes boolean not null default true;

comment on column public.invoice_email_settings.email_invoices is
  'Organization switch: when false no invoice e-mail is queued (neither on invoicing nor on a manual send).';
comment on column public.invoice_email_settings.email_credit_notes is
  'Organization switch: when false no credit note e-mail is queued (neither on crediting nor on a manual send).';

grant insert (email_invoices, email_credit_notes), update (email_invoices, email_credit_notes)
  on public.invoice_email_settings to authenticated;

alter table public.work_receipt_email_settings
  add column email_work_receipts boolean not null default true;

comment on column public.work_receipt_email_settings.email_work_receipts is
  'Organization switch: when false work receipts cannot be e-mailed.';

grant insert (email_work_receipts), update (email_work_receipts)
  on public.work_receipt_email_settings to authenticated;
