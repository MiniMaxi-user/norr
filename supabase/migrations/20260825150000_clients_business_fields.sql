-- Expand public.clients with Dutch business-registration fields, and drop
-- clients.email (issue #43, "Breid client uit" / expand the Client entity).
--
-- Product decision (confirmed with the user): a client's own `email` column
-- goes away entirely. Client contact email now comes from a `contacts` row
-- (contacts already have their own `email` column — see
-- supabase/migrations/20260823090000_contacts_dependent_reference_lists.sql,
-- app/(app)/clients/contacts-actions.ts) or is simply not tracked at the
-- client level. This is scoped to `clients` only — nothing else gains an
-- email column as part of this change.
--
-- Checked before writing this migration (same due-diligence pattern as
-- 20260825120000_sites_drop_name.sql):
--   - No index, generated column, or RLS policy predicate references
--     clients.email — clients' RLS policies (clients_select_member/
--     insert_owner/update_owner/delete_owner, in
--     20260822190000_clients_sites_assets.sql) are organization_id-keyed
--     only.
--   - Column-level INSERT/UPDATE grants on clients DO reference `email` —
--     the last migration to state them was
--     20260822193000_fix_clients_sites_assets_column_grants.sql, but
--     20260825090000_sites_addresses.sql subsequently dropped clients'
--     flat address_line1/address_line2/postal_code/city/country columns
--     WITHOUT re-issuing the grant statement text (Postgres auto-drops a
--     dropped column's own per-column privilege entries, so this was
--     functionally harmless but left the grant statement's *documentation*
--     out of date). The grants re-issued below reflect clients' actual
--     current column set: `email` removed, the five already-dropped
--     address columns also omitted (re-adding them to a grant would be a
--     no-op at best and misleading at worst), and kvk_number/vat_number/
--     iban added. Plain `grant` (not `revoke all` + `grant`) is sufficient
--     here — same reasoning 20260825120000_sites_drop_name.sql used for
--     `sites`: narrowing/extending an existing column list by
--     omission/addition, not correcting a prior over-broad table-wide
--     grant.
--   - supabase/tests/database/clients_sites_assets_rls.test.sql inserts
--     into clients with an explicit `email` column in one fixture (the
--     very first clients insert, 'owner_a can insert a client into
--     org_a') — updated in the same commit as this migration to drop
--     `email` from that column list, mirroring the sites.name fixture fix
--     in 20260825120000_sites_drop_name.sql.

alter table public.clients
  drop column email;

alter table public.clients
  add column kvk_number text,
  add column vat_number text,
  add column iban text;

comment on column public.clients.kvk_number is
  'Dutch Chamber of Commerce (KvK) registration number. Plain text, no format validation at the DB layer.';
comment on column public.clients.vat_number is
  'VAT / BTW number. Plain text, no format validation at the DB layer.';
comment on column public.clients.iban is
  'Bank account IBAN. Plain text, no format validation at the DB layer.';

-- Re-issue the clients insert/update column grants reflecting clients'
-- actual current column set: `email` removed, kvk_number/vat_number/iban
-- added. See note above on why a plain `grant` (no preceding `revoke all`)
-- is sufficient here.
grant insert (
  organization_id, name, phone,
  kvk_number, vat_number, iban,
  notes
) on public.clients to authenticated;
grant update (
  name, phone,
  kvk_number, vat_number, iban,
  notes
) on public.clients to authenticated;
