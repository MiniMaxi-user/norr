-- Quotes are no longer linked to a site (product decision 2026-10-12): the
-- quote form, detail page and server actions no longer read or write
-- quotes.site_id. This stops the work-order auto-draft trigger from copying
-- the work order's site onto its shadow quote. The nullable column itself is
-- left in place (no data loss; legacy values are simply unused).

create or replace function public.create_work_order_auto_draft_quote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.quotes (client_id, work_order_id, name, is_auto_draft)
  values (new.client_id, new.id, 'Quote — ' || new.title, true);

  return new;
end;
$$;

comment on function public.create_work_order_auto_draft_quote() is
  'AFTER INSERT trigger on public.work_orders (issue #109): creates the linked is_auto_draft quote for every new work order, unconditionally. SECURITY DEFINER so this INSERT into quotes succeeds despite is_auto_draft being withheld from the client-facing INSERT grant, and regardless of the inserting role''s own quotes RLS privileges. client_id copied from the work order (no site: quotes are not linked to a site since 20261012090000); status_id left unset so derive_quote_organization_id fills in the org''s default quote_status.';
