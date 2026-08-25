-- Platform Admin managing tenants by reusing the Clients module (issue #45).
--
-- A `Client` row can optionally *represent* a real platform tenant (an
-- `organizations` row) via this new nullable link column, rather than
-- merging the `clients` and `organizations` tables. Every existing Client
-- feature (Sites, Contacts, Assets, Contracts, Work Orders, Quotes) keeps
-- working unchanged for a linked client -- that's the whole point. The
-- Platform Admin operates by being an `owner` member of a dedicated
-- "Platform" organization, and manages tenants as `clients` rows *within*
-- that Platform organization; `represents_organization_id` is what turns
-- one of those client rows into an actual tenant.
--
-- Nullable, `on delete set null` (not cascade): if the linked organization
-- is ever deleted, the Platform's client record documenting that former
-- tenant should survive as an ordinary (now unlinked) CRM client, not be
-- destroyed.
--
-- Unique (partial, `where represents_organization_id is not null`): an
-- organization can be represented by at most one client row -- otherwise
-- "the Client that manages this tenant" would be ambiguous. Partial so it
-- doesn't constrain the (overwhelmingly common) `null` case at all.
--
-- ---------------------------------------------------------------------------
-- RLS: no new/changed policy needed.
--
-- Writing this column is already covered by the existing
-- `clients_update_owner` policy (`supabase/migrations/
-- 20260822190000_clients_sites_assets.sql`):
--
--   create policy "clients_update_owner"
--   on public.clients
--   for update
--   to authenticated
--   using (public.is_org_owner(organization_id))
--   with check (public.is_org_owner(organization_id));
--
-- `is_org_owner(org_id)` checks the CALLER's own membership row
-- (`m.organization_id = org_id and m.user_id = auth.uid() and m.role =
-- 'owner'`) against the CLIENT ROW's OWN `organization_id` -- not the
-- organization being linked to. The client row being activated here is a
-- client that lives inside the Platform organization (i.e.
-- `clients.organization_id = <Platform org id>`), so the Platform Admin,
-- as an `owner` member of the Platform org, already satisfies this policy
-- on that row -- exactly the same as any other tenant owner updating any
-- other client of theirs. No elevated/service-role access, and no new
-- policy, is needed: this is an ordinary same-tenant client update, the
-- "tenant" here just happens to be the Platform org itself.
--
-- ---------------------------------------------------------------------------
-- Due diligence performed before writing this migration:
--   - No index, generated column, RLS policy predicate, or trigger
--     anywhere in supabase/migrations/ references anything named
--     `represents_organization_id` or similar -- this is a wholly new
--     column.
--   - supabase/tests/database/clients_sites_assets_rls.test.sql's five
--     `insert into public.clients (...)` fixtures all use explicit,
--     narrower column lists (none select `*` / rely on column order) --
--     an additive nullable column with no default is a no-op for all of
--     them. No fixture update needed.
--   - docs/ARCHITECTURE.md's `clients` bullet (Core schema (v1)) is
--     updated in the same change to reference this migration, following
--     the pattern already used for the last few `clients`/`sites` schema
--     changes documented there this session.
--
-- ---------------------------------------------------------------------------
-- One-time manual bootstrap (run by hand once, not part of this migration):
--   1. insert into organizations (name) values ('Norr') -- the Platform org itself
--   2. update users set is_platform_admin = true where email = '<the admin''s email>'
--   3. insert into memberships (user_id, organization_id, role) values ('<that user's id>', '<the Platform org's id from step 1>', 'owner')

alter table public.clients
  add column represents_organization_id uuid references public.organizations (id) on delete set null;

create unique index clients_represents_organization_id_idx
  on public.clients (represents_organization_id)
  where represents_organization_id is not null;

comment on column public.clients.represents_organization_id is
  'When set, this Client row IS a real platform tenant (issue #45) -- links to the organizations row a Platform Admin manages (modules, member access) through this same Client record. Null for an ordinary CRM client.';

-- Re-issue the clients insert/update column grants reflecting clients'
-- actual current column set (adding `represents_organization_id` to the
-- UPDATE grant only -- see below for why it's deliberately absent from
-- INSERT). Same "re-issue the full current grant list" pattern used
-- repeatedly this session (most recently
-- 20260825150000_clients_business_fields.sql).
--
-- Insert-list left unchanged from that migration (organization_id, name,
-- phone, kvk_number, vat_number, iban, notes): a brand-new client is never
-- created already representing a tenant -- `activateAsTenant` (issue #45,
-- app/(app)/clients/actions.ts) always operates on an existing client row
-- via UPDATE, one representing-organization-link at a time. Granting it on
-- INSERT too would let a caller set an arbitrary organization_id on
-- creation without going through that action's guards (idempotency check,
-- organization creation, etc.) -- update-only mirrors how `created_by` and
-- the various derived/denormalized `organization_id` columns elsewhere in
-- this schema are locked down to exactly the write path that's supposed to
-- populate them.
grant update (
  name, phone,
  kvk_number, vat_number, iban,
  notes, represents_organization_id
) on public.clients to authenticated;
