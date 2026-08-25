-- Drop public.sites.name (issue #42, "Remove the Name field from a client's
-- Site/address").
--
-- A site is now identified purely by its formatted address everywhere in the
-- app (e.g. "Vleutenseweg 22, Utrecht") instead of a separately-typed free-
-- text label — that display-layer cascade (every place that currently reads
-- sites.name) is being handled by api-backend-engineer/frontend-ui-engineer
-- right after this migration; this migration is only the DB-side removal of
-- the column itself.
--
-- Checked before writing this migration (per db-schema-architect's task):
--   - No index, generated column, or RLS policy predicate references
--     sites.name directly — the only other things that named it were the
--     column-level INSERT/UPDATE grants (see below) and pgTAP test
--     fixtures (updated in the same commit as this migration:
--     supabase/tests/database/clients_sites_assets_rls.test.sql,
--     contracts_rls.test.sql, quotes_rls.test.sql, work_orders_rls.test.sql,
--     contacts_dependent_reference_lists_rls.test.sql).
--   - Postgres automatically drops a column's own per-column privilege
--     entries when the column itself is dropped, so no `revoke` is strictly
--     required — but the insert/update column-level grants on `sites`
--     (originally set in 20260822190000_clients_sites_assets.sql, corrected
--     in 20260822193000_fix_clients_sites_assets_column_grants.sql, and
--     additively extended in 20260825090000_sites_addresses.sql) are
--     re-issued below with `name` removed from the column list, so the
--     grant statements that describe the table's current writable-column
--     surface stay accurate and don't silently rely on that automatic
--     cleanup.
alter table public.sites
  drop column name;

-- Re-issue the sites insert/update column grants without `name`. Plain
-- `grant` (not `revoke all` + `grant`) is sufficient here: we are narrowing
-- an existing grant list by omission, not correcting a prior over-broad
-- grant (contrast with 20260822193000_fix_clients_sites_assets_column_grants.sql,
-- which had to `revoke all` first because the table-wide default grant to
-- `authenticated` had never been revoked at all). `grant insert/update (...)`
-- with a column list that excludes `name` fully replaces the previous
-- column-level entry for `name` on those privilege types the moment the
-- column is dropped (there is nothing left to reference), and the other
-- columns' grants are unaffected by re-stating them.
grant insert (
  client_id,
  address_line1, address_line2, postal_code, city, country,
  latitude, longitude, notes,
  is_visit_address, is_invoice_address, is_delivery_address,
  is_primary, geocoded_at
) on public.sites to authenticated;
grant update (
  client_id,
  address_line1, address_line2, postal_code, city, country,
  latitude, longitude, notes,
  is_visit_address, is_invoice_address, is_delivery_address,
  is_primary, geocoded_at
) on public.sites to authenticated;
