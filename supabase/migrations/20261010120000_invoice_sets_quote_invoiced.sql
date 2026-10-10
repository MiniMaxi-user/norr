-- When an invoice is created, set its quote's status to the organization's
-- quote_status item 'invoiced'. SECURITY DEFINER because quotes are only
-- updatable by owner/planner while administratie may invoice. If the
-- organization has no 'invoiced' item (e.g. deleted by the tenant) the status
-- is left unchanged. Separate trigger from invoices_advance_contract_period.
create or replace function public.set_quote_invoiced_on_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item_id uuid;
begin
  select rli.id into v_item_id
  from public.reference_list_items rli
  join public.reference_lists rl on rl.id = rli.reference_list_id
  where rl.organization_id = new.organization_id
    and rl.list_key = 'quote_status'
    and rli.value = 'invoiced'
  limit 1;

  if v_item_id is not null then
    update public.quotes set status_id = v_item_id where id = new.quote_id;
  end if;

  return null;
end;
$$;

comment on function public.set_quote_invoiced_on_invoice() is
  'AFTER INSERT trigger on public.invoices: sets the quote''s status_id to the org''s quote_status ''invoiced'' item; no-op if the org has none.';

create trigger invoices_set_quote_invoiced
  after insert on public.invoices
  for each row execute function public.set_quote_invoiced_on_invoice();
