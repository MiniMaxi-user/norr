-- Site contact persons (issue #52, "Bij sites detail pagina wil ik
-- contactpersonen kunnen beheren").
--
-- A site already carries three purpose flags (is_visit_address /
-- is_invoice_address / is_delivery_address, added by
-- 20260825090000_sites_addresses.sql). This migration adds a nullable
-- "who is the contact person for that purpose" FK per flag, pointing into
-- `public.contacts` (20260823090000_contacts_dependent_reference_lists.sql):
--
--   visit_contact_id, delivery_contact_id, invoice_contact_id
--
-- All three: `uuid null references public.contacts (id) on delete set
-- null`. `on delete set null` (not cascade/restrict) is deliberate: deleting
-- a contact must not be blocked by, or cascade-delete, a site that merely
-- references them as its visit/delivery/invoice person — it should just
-- clear back to unset.
--
-- Cross-entity integrity: a plain FK only guarantees "this id exists in
-- contacts somewhere in the whole table" — it cannot express "and that
-- contact belongs to the SAME CLIENT as this site" (sites and contacts both
-- hang off `client_id`, and a client's contacts must not be selectable as
-- another client's — even a same-organization, different-client — site
-- contact person). validate_site_contact_persons closes that gap, following
-- the exact structural style of validate_asset_reference_items /
-- validate_contact_role_item: SECURITY DEFINER (so it can resolve the
-- referenced contact regardless of the caller's own RLS visibility into it),
-- resolves each non-null contact FK's client_id, and raises 23514 if it
-- doesn't match the site's own client_id (23503 if the FK doesn't resolve to
-- an existing contacts row at all — though the real FK constraint below
-- already guarantees that in practice; kept for the same defensive-symmetry
-- reason the precedent triggers keep their own "doesn't reference an
-- existing row" branch even though it's normally unreachable).
--
-- Deliberately NOT added here: a DB-level "required when the matching
-- purpose flag is true" CHECK (e.g. check (not is_visit_address or
-- visit_contact_id is not null)). Unlike sites_at_least_one_purpose, there
-- is no sensible backfill value for existing sites that already have (say)
-- is_visit_address = true with no contact assigned — a blocking CHECK would
-- either fail this migration outright against real data or force fabricating
-- placeholder contact references, both wrong. That "required when checked"
-- rule is deliberately left as an application-layer concern (Zod schema +
-- server actions), same as the per-client purpose-coverage aggregate check
-- noted in 20260825090000_sites_addresses.sql. Confirmed live: several
-- existing sites already have purpose flags true with no contact columns to
-- backfill from (the columns didn't exist before this migration), so a
-- required-ness CHECK would in fact reject nothing today but would still be
-- the wrong layer for a rule that legitimately depends on user input, not on
-- fixed structural shape.
--
-- RLS coverage check: sites_insert_owner / sites_update_owner
-- (20260822190000_clients_sites_assets.sql) key entirely on
-- is_org_owner(organization_id) — no column-specific predicate. Three more
-- nullable columns on an already-RLS'd, row-owner-scoped table need no new
-- policy, same reasoning already documented in
-- 20260826130000_sites_phone.sql for sites.phone and
-- 20260825120000_sites_drop_name.sql for the name-column drop. Only the
-- column-level INSERT/UPDATE grants need extending (additive, like
-- is_visit_address/is_invoice_address/is_delivery_address/is_primary/
-- geocoded_at in 20260825090000_sites_addresses.sql — this table's grants
-- were already correctly locked down by
-- 20260822193000_fix_clients_sites_assets_column_grants.sql, so no `revoke
-- all` is needed here, just additive `grant`).

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.sites
  add column visit_contact_id uuid references public.contacts (id) on delete set null,
  add column delivery_contact_id uuid references public.contacts (id) on delete set null,
  add column invoice_contact_id uuid references public.contacts (id) on delete set null;

comment on column public.sites.visit_contact_id is
  'Contact person for this site''s visit purpose (relevant when is_visit_address is true; "required when checked" is an application-layer rule, not a DB CHECK — see migration header). Nullable, on delete set null. Must belong to the same client_id as the site (validate_site_contact_persons), not merely the same organization.';
comment on column public.sites.delivery_contact_id is
  'Contact person for this site''s delivery purpose (relevant when is_delivery_address is true). See visit_contact_id comment for the nullability/validation rules, identical here.';
comment on column public.sites.invoice_contact_id is
  'Contact person for this site''s invoice purpose (relevant when is_invoice_address is true). See visit_contact_id comment for the nullability/validation rules, identical here.';

create index sites_visit_contact_id_idx on public.sites (visit_contact_id);
create index sites_delivery_contact_id_idx on public.sites (delivery_contact_id);
create index sites_invoice_contact_id_idx on public.sites (invoice_contact_id);

-- ---------------------------------------------------------------------------
-- 2. Cross-entity validation: each non-null contact FK must belong to the
--    SAME client_id as the site (not just the same organization_id).
--    Same structural style as validate_asset_reference_items /
--    validate_contact_role_item.
-- ---------------------------------------------------------------------------
create or replace function public.validate_site_contact_persons()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visit_client_id uuid;
  v_delivery_client_id uuid;
  v_invoice_client_id uuid;
begin
  if new.visit_contact_id is not null then
    select client_id into v_visit_client_id
    from public.contacts
    where id = new.visit_contact_id;

    if v_visit_client_id is null then
      raise exception 'sites.visit_contact_id % does not reference an existing contact', new.visit_contact_id
        using errcode = '23503';
    elsif v_visit_client_id <> new.client_id then
      raise exception 'sites.visit_contact_id must reference a contact belonging to the same client as the site'
        using errcode = '23514';
    end if;
  end if;

  if new.delivery_contact_id is not null then
    select client_id into v_delivery_client_id
    from public.contacts
    where id = new.delivery_contact_id;

    if v_delivery_client_id is null then
      raise exception 'sites.delivery_contact_id % does not reference an existing contact', new.delivery_contact_id
        using errcode = '23503';
    elsif v_delivery_client_id <> new.client_id then
      raise exception 'sites.delivery_contact_id must reference a contact belonging to the same client as the site'
        using errcode = '23514';
    end if;
  end if;

  if new.invoice_contact_id is not null then
    select client_id into v_invoice_client_id
    from public.contacts
    where id = new.invoice_contact_id;

    if v_invoice_client_id is null then
      raise exception 'sites.invoice_contact_id % does not reference an existing contact', new.invoice_contact_id
        using errcode = '23503';
    elsif v_invoice_client_id <> new.client_id then
      raise exception 'sites.invoice_contact_id must reference a contact belonging to the same client as the site'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_site_contact_persons() is
  'BEFORE INSERT/UPDATE OF client_id, visit_contact_id, delivery_contact_id, invoice_contact_id trigger on public.sites: rejects any of the three contact FKs when the referenced contacts row belongs to a different client_id than the site itself (same-organization is not sufficient — two different clients in the same organization must not cross-reference each other''s contacts). SECURITY DEFINER so it can resolve the referenced contact regardless of the caller''s own RLS visibility into contacts, same reasoning as validate_asset_reference_items/validate_contact_role_item. client_id is included in the trigger''s column list (even though client_id is not itself an FK validated here) because re-parenting a site to a different client can silently invalidate a previously-valid contact reference without touching the contact columns themselves.';

create trigger sites_validate_contact_persons
  before insert or update of client_id, visit_contact_id, delivery_contact_id, invoice_contact_id on public.sites
  for each row execute function public.validate_site_contact_persons();

-- ---------------------------------------------------------------------------
-- 3. Column-level grants: additive only (see migration header — sites'
--    revoke-all lockdown already happened in
--    20260822193000_fix_clients_sites_assets_column_grants.sql).
-- ---------------------------------------------------------------------------
grant insert (
  visit_contact_id, delivery_contact_id, invoice_contact_id
) on public.sites to authenticated;
grant update (
  visit_contact_id, delivery_contact_id, invoice_contact_id
) on public.sites to authenticated;
