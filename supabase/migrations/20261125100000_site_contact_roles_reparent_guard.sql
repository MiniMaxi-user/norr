-- Issue #273 (QA blocker B1): re-parenting a site must clear its contact matrix.
--
-- The dropped validate_site_contact_persons trigger (20260826150000) used to
-- re-check the contact FKs on UPDATE OF client_id, so a site moved to another
-- client could never keep the old client's contacts. site_contact_roles rows
-- belong to the site's client; after a client move they would point at another
-- client's contacts. This trigger deletes them when client_id really changes,
-- in the same statement, so an app-level failure after the move can never leave
-- another client's contacts ticked. SECURITY DEFINER (search_path public) so the
-- delete does not depend on the caller's policies on site_contact_roles; only
-- callers allowed to UPDATE the site (sites RLS) can reach it.

create or replace function public.clear_site_contact_roles_on_reparent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.client_id is distinct from old.client_id then
    delete from public.site_contact_roles where site_id = new.id;
  end if;
  return new;
end;
$$;

comment on function public.clear_site_contact_roles_on_reparent() is
  'BEFORE UPDATE OF client_id trigger on public.sites: when client_id changes, deletes the site''s site_contact_roles rows (they belong to the old client). Replaces the re-check the dropped validate_site_contact_persons trigger did.';

create trigger sites_clear_contact_roles_on_reparent
  before update of client_id on public.sites
  for each row execute function public.clear_site_contact_roles_on_reparent();
