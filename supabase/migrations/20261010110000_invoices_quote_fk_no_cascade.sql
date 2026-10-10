-- Invoices are permanent (20261010100000): a quote that has an invoice can no
-- longer be deleted. Changes invoices.quote_id from ON DELETE CASCADE to NO
-- ACTION (SQLSTATE 23503 foreign_key_violation when deleting an invoiced
-- quote). NO ACTION rather than RESTRICT so that deleting a whole organization
-- (which cascades to both quotes and invoices in one statement) still works;
-- for a direct quote delete the behavior is identical to RESTRICT.
alter table public.invoices
  drop constraint invoices_quote_id_fkey,
  add constraint invoices_quote_id_fkey
    foreign key (quote_id) references public.quotes (id);

comment on column public.invoices.quote_id is
  'The quote this invoice was generated from. unique -- a quote has at most one invoice. A quote with an invoice cannot be deleted (FK without cascade, SQLSTATE 23503).';
