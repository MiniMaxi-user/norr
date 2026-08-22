-- Fix: column-level INSERT/UPDATE lockdown on clients/sites/assets (added in
-- 20260822190000_clients_sites_assets.sql) did not actually restrict
-- anything.
--
-- Root cause: this Supabase project's `public` schema has a default
-- privilege configuration that grants ALL table privileges (SELECT, INSERT,
-- UPDATE, DELETE, ...) on every newly created table to `authenticated` (and
-- `anon`) automatically — confirmed live via
-- `information_schema.role_table_grants`. GRANT is purely additive in
-- Postgres: issuing `grant insert (col_a, col_b) on t to authenticated`
-- ADDS column-scoped INSERT privilege on col_a/col_b, it does NOT remove
-- the pre-existing (from default privileges) unrestricted INSERT privilege
-- on every other column of the same table. The migration this fixes wrote
-- only the additive column-level GRANTs (mirroring the *comments* of the
-- `users`/`invites` column-lockdown pattern) but omitted the
-- `revoke ... from authenticated` step that pattern actually depends on —
-- `20260822150910_organizations_memberships_baseline_rls.sql` does this
-- correctly for `public.users` (`revoke update on public.users from
-- authenticated;` before granting `update (full_name)`), which is why that
-- one actually works and this one didn't.
--
-- Confirmed live (via direct REST calls, service-role-created test users,
-- cleaned up after): `POST /rest/v1/clients` with an explicit `created_by`
-- succeeded at the privilege layer (only saved because `set_created_by`
-- unconditionally overwrites it on every INSERT); `POST /rest/v1/sites`
-- with an explicit `organization_id`, and `POST /rest/v1/assets` with an
-- explicit `client_id`, likewise succeeded at the privilege layer. Insert
-- paths happened to be masked by the BEFORE INSERT derive/stamp triggers
-- unconditionally overwriting those columns regardless of what was
-- submitted — but `derive_site_organization_id` / `derive_asset_org_and_client`
-- only fire `on update OF client_id` / `OF site_id` respectively (Postgres
-- column-specific triggers only fire when that column appears in the
-- UPDATE's SET list), and `set_created_by` only fires on INSERT at all — so
-- a plain `UPDATE public.sites SET organization_id = '<other-org>' WHERE
-- id = ...` (leaving client_id untouched) or `UPDATE public.clients SET
-- created_by = '<arbitrary-uuid>' WHERE id = ...` would have gone through
-- with no trigger recomputation to catch it, for anyone who otherwise
-- passes the row-level `is_org_owner(organization_id)` check. That's the
-- part actually worth fixing here, independent of the fact that INSERT was
-- already incidentally safe.
--
-- Fix: explicitly revoke all default-granted privileges from
-- `authenticated` on all three tables, then re-grant exactly what was
-- originally intended: unrestricted SELECT/DELETE, and INSERT/UPDATE
-- restricted to the same column lists as before (organization_id on sites,
-- client_id + organization_id on assets, and created_by on all three,
-- remain excluded from both INSERT and UPDATE column grants — derived/
-- stamped by trigger only, never client-writable, on insert AND update).
--
-- Lesson for future tenant-scoped tables in this codebase: after any
-- column-restricted GRANT, always precede it with `revoke all on <table>
-- from authenticated;` (or at least `revoke insert, update`) — do not
-- assume a fresh table starts with zero privileges for `authenticated`.

revoke all on public.clients from authenticated;
revoke all on public.sites from authenticated;
revoke all on public.assets from authenticated;

-- ---------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------
grant select, delete on public.clients to authenticated;
grant insert (
  organization_id, name, email, phone,
  address_line1, address_line2, postal_code, city, country, notes
) on public.clients to authenticated;
grant update (
  name, email, phone,
  address_line1, address_line2, postal_code, city, country, notes
) on public.clients to authenticated;

-- ---------------------------------------------------------------------------
-- sites
-- ---------------------------------------------------------------------------
grant select, delete on public.sites to authenticated;
-- organization_id intentionally excluded from both grants below: derived
-- by derive_site_organization_id, never client-writable.
grant insert (
  client_id, name,
  address_line1, address_line2, postal_code, city, country,
  latitude, longitude, notes
) on public.sites to authenticated;
grant update (
  client_id, name,
  address_line1, address_line2, postal_code, city, country,
  latitude, longitude, notes
) on public.sites to authenticated;

-- ---------------------------------------------------------------------------
-- assets
-- ---------------------------------------------------------------------------
grant select, delete on public.assets to authenticated;
-- client_id / organization_id intentionally excluded from both grants
-- below: derived by derive_asset_org_and_client, never client-writable.
grant insert (
  site_id, name, type, manufacturer, model, serial_number,
  status, installed_at, warranty_until, notes
) on public.assets to authenticated;
grant update (
  site_id, name, type, manufacturer, model, serial_number,
  status, installed_at, warranty_until, notes
) on public.assets to authenticated;
