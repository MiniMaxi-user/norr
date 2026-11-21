-- Issue #273: PO decision - a site can NEVER be moved to another client.
-- sites.client_id becomes immutable. This SUPERSEDES 20261125100000
-- (re-parent guard that cleared the contact matrix): that trigger and function
-- are dropped, because re-parenting no longer exists.
--
-- Two layers:
--   1. Privilege: the column-level UPDATE grant on sites.client_id is revoked
--      from authenticated (it was granted in 20260822190000 and re-issued in
--      20260915090000). INSERT of client_id stays.
--   2. Defense in depth: a BEFORE UPDATE OF client_id trigger raises 23514 when
--      client_id changes (reaches roles that bypass the grant, e.g. the owner).

drop trigger sites_clear_contact_roles_on_reparent on public.sites;
drop function public.clear_site_contact_roles_on_reparent();

revoke update (client_id) on public.sites from authenticated;

create or replace function public.forbid_site_client_change()
returns trigger
language plpgsql
as $$
begin
  if new.client_id is distinct from old.client_id then
    raise exception 'The client of a site cannot be changed'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

comment on function public.forbid_site_client_change() is
  'BEFORE UPDATE OF client_id trigger on public.sites: a site can never move to another client (PO decision, issue #273). Defense in depth next to the revoked column UPDATE grant.';

create trigger sites_client_id_immutable
  before update of client_id on public.sites
  for each row execute function public.forbid_site_client_change();
