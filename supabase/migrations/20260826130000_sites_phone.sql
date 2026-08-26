-- Move phone from clients to sites (product decision: a client's phone
-- number belongs on the Site — the physical location/address — not on the
-- Client itself, since a client can have multiple sites, each potentially
-- with its own contact number).
--
-- This migration is schema/RLS-layer ONLY. `app/(app)/clients/schema.ts`,
-- `actions.ts`, and every form/table/kanban/detail component that reads or
-- writes `phone` are explicitly out of scope here — a separate
-- api-backend-engineer/frontend-ui-engineer pass follows this migration.
--
-- ---------------------------------------------------------------------------
-- 1. Column move
-- ---------------------------------------------------------------------------
alter table public.sites
  add column phone text;

comment on column public.sites.phone is
  'Contact phone number for this physical location. Plain nullable text, no format validation at the DB layer — same treatment clients.phone previously got (and kvk_number/vat_number on clients still get).';

alter table public.clients
  drop column phone;

-- ---------------------------------------------------------------------------
-- 2. RLS check: no policy or index changes needed.
--
-- Read `sites`' RLS policies (20260822190000_clients_sites_assets.sql):
--   sites_select_member: using (is_member_of_org(organization_id))
--   sites_insert_owner / sites_update_owner / sites_delete_owner:
--     using/with check (is_org_owner(organization_id))
-- None of these predicates reference individual columns — they key
-- entirely on organization_id — so adding a plain nullable text column
-- requires no policy change. Same reasoning applies to `clients`' policies
-- for the column drop. Confirmed no index, generated column, or trigger
-- anywhere in supabase/migrations/ references clients.phone or sites.phone
-- besides the column-level grant lists re-issued below (grepped
-- supabase/migrations/ and supabase/tests/ for "phone" — the only other
-- hits are contacts.phone, a wholly separate column on a different table,
-- untouched here).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 3. Re-issue the full current INSERT/UPDATE column grants for BOTH
--    clients (now without phone) and sites (now with phone), following the
--    same "re-issue the full current column set" pattern used by
--    20260825150000_clients_business_fields.sql and
--    20260825160000_clients_represents_organization.sql. Plain `grant` (not
--    `revoke all` + `grant`) is sufficient — narrowing/extending an
--    existing column-level grant list by omission/addition, not correcting
--    a prior over-broad table-wide grant (that correction already happened
--    once, in 20260822193000_fix_clients_sites_assets_column_grants.sql).
-- ---------------------------------------------------------------------------

-- clients: current full column set is
-- (id, organization_id, name, kvk_number, vat_number, iban, notes,
--  represents_organization_id, created_by, created_at, updated_at) —
-- phone removed, everything else unchanged from
-- 20260825160000_clients_represents_organization.sql.
grant insert (
  organization_id, name,
  kvk_number, vat_number, iban,
  notes
) on public.clients to authenticated;
grant update (
  name,
  kvk_number, vat_number, iban,
  notes, represents_organization_id
) on public.clients to authenticated;

-- sites: phone added to both INSERT and UPDATE. Unlike
-- clients.represents_organization_id (deliberately UPDATE-only), a site's
-- phone is a normal field a caller should be able to set at creation time
-- too, same as its address fields — organization_id remains excluded
-- (derived by derive_site_organization_id).
grant insert (
  client_id, phone,
  address_line1, address_line2, postal_code, city, country,
  latitude, longitude, notes,
  is_visit_address, is_invoice_address, is_delivery_address,
  is_primary, geocoded_at
) on public.sites to authenticated;
grant update (
  client_id, phone,
  address_line1, address_line2, postal_code, city, country,
  latitude, longitude, notes,
  is_visit_address, is_invoice_address, is_delivery_address,
  is_primary, geocoded_at
) on public.sites to authenticated;
