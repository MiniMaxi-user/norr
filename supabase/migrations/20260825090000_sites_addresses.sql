-- Sites as client addresses (redo of issue #41, "Als Owner/Planner/Engineer/
-- Finance/Administratie wil ik adressen kunnen beheren op een client").
--
-- A first pass of this story built a brand-new `client_addresses` table.
-- Corrected: `public.sites` (supabase/migrations/20260822190000_clients_sites_assets.sql)
-- ALREADY is the client-address entity (it doubles as the location `assets`
-- hang off of via `assets.site_id` — that dual role is intentional and is
-- NOT being split apart here). This migration extends `sites` in place
-- instead of introducing a parallel entity. See design notes 1-3 at the top
-- of 20260822190000_clients_sites_assets.sql for the existing
-- organization_id-denormalization / write-boundary / created_by pattern this
-- migration continues, unmodified.
--
-- What this migration adds to `public.sites`:
--   1. Purpose flags: is_visit_address / is_invoice_address /
--      is_delivery_address ("Bezoekadres, Factuuradres, Afleveradres" from
--      the story). CHECK: at least one of the three must be true per row
--      (sites_at_least_one_purpose). Every pre-existing site is backfilled
--      is_visit_address = true (a site was already, by construction, "a
--      place a technician visits" before this migration existed) so the new
--      CHECK never rejects historical data, and so the backfill doesn't
--      invent billing/delivery semantics that were never true of it.
--   2. is_primary: at most one true per client_id (partial unique index +
--      an auto-unset-previous-primary trigger, mirroring
--      enforce_single_primary_contact / contacts_one_primary_per_client_idx
--      from 20260823090000_contacts_dependent_reference_lists.sql exactly,
--      just keyed off client_id the same way that one already is).
--   3. geocoded_at: companion timestamp to the pre-existing latitude/
--      longitude columns, which are being repurposed from "manually typed
--      by the user" to "a geocoding cache computed server-side from the
--      address fields" (story requirement: "Pin op kaart wordt bepaald door
--      adres gegevens, niet latlong"). No other DB-level change to
--      latitude/longitude — they stay plain nullable double precision,
--      still writable through the normal owner-authenticated grant, because
--      it's `api-backend-engineer`'s server action (calling
--      lib/geocoding/nominatim.ts, already present in this repo from the
--      earlier pass and reused as-is) that will write a geocoded value
--      through that path, not a DB trigger.
--
-- Cross-row invariant, intentionally NOT enforced here: "minimaal een adres
-- met een bezoek/factuur/afleveradres" per CLIENT (not per site) — across
-- ALL of a client's sites, each of the three purposes must be covered by at
-- least one site (a single site may cover more than one, or all three).
-- This is a cross-row, per-client aggregate check, not a plain row CHECK.
-- It is `api-backend-engineer`'s responsibility to validate in
-- createSite/updateSite/deleteSite (reject a write that would leave a
-- purpose uncovered for that client) — deliberately not built as an
-- aggregate trigger here to avoid overengineering a simple, small
-- multi-write invariant into schema-layer complexity.
--
-- Also folded into this migration: `public.clients` still carried its own
-- flat, single legacy address (address_line1/address_line2/postal_code/
-- city/country) predating `sites`. Since `sites` is now the sole
-- authoritative multi-address model for a client, every client with a
-- non-null legacy address_line1 and NO existing sites gets exactly one new
-- site created from that data (name 'Main address', all three purpose flags
-- true, is_primary true) before the flat columns are dropped from
-- `clients`. A client that already has sites AND also still had a non-null
-- flat address is a judgment call: that legacy data is dropped, not
-- migrated — there is no reliable way to guess which of that client's
-- existing sites the old flat address corresponds to, and duplicating it
-- onto a brand new unrelated site would be worse than dropping it.
-- `clients` never had latitude/longitude columns, so there is nothing to
-- carry over on that front.

-- ---------------------------------------------------------------------------
-- 1. Purpose flags
-- ---------------------------------------------------------------------------
alter table public.sites
  add column is_visit_address boolean not null default false,
  add column is_invoice_address boolean not null default false,
  add column is_delivery_address boolean not null default false;

comment on column public.sites.is_visit_address is
  'Visit address — a technician visits this site. At least one of is_visit_address/is_invoice_address/is_delivery_address must be true per row (sites_at_least_one_purpose). Backfilled true for every site that existed before this column did.';
comment on column public.sites.is_invoice_address is
  'Invoice address — invoices for the client are addressed here. See is_visit_address for the at-least-one-purpose CHECK.';
comment on column public.sites.is_delivery_address is
  'Delivery address — deliveries/parts are shipped here. See is_visit_address for the at-least-one-purpose CHECK.';

-- Backfill BEFORE the CHECK constraint below: every site that already
-- existed is, by construction, a place a technician visits (sites already
-- served as the location assets hang off of before purpose flags existed) —
-- set is_visit_address = true so the CHECK never rejects a pre-existing row.
update public.sites
set is_visit_address = true
where not (is_visit_address or is_invoice_address or is_delivery_address);

alter table public.sites
  add constraint sites_at_least_one_purpose
  check (is_visit_address or is_invoice_address or is_delivery_address);

-- ---------------------------------------------------------------------------
-- 2. is_primary: at most one per client_id. Mirrors
--    contacts.is_primary / enforce_single_primary_contact /
--    contacts_one_primary_per_client_idx exactly, keyed off client_id here
--    the same way that one already is (sites and contacts hang off clients
--    the same way).
-- ---------------------------------------------------------------------------
alter table public.sites
  add column is_primary boolean not null default false;

comment on column public.sites.is_primary is
  'At most one true per client_id (enforced by enforce_single_primary_site + sites_one_primary_per_client_idx) — the client''s main address, badged in overviews/detail pages. Mirrors contacts.is_primary/enforce_single_primary_contact.';

create unique index sites_one_primary_per_client_idx
  on public.sites (client_id)
  where is_primary;

-- Auto-unsets any previous primary site for the same client before this
-- row's write completes, so setting a new primary never collides with
-- sites_one_primary_per_client_idx. Mirrors enforce_single_primary_contact.
create or replace function public.enforce_single_primary_site()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_primary then
    update public.sites
    set is_primary = false
    where client_id = new.client_id
      and id <> new.id
      and is_primary = true;
  end if;
  return new;
end;
$$;

comment on function public.enforce_single_primary_site() is
  'BEFORE INSERT/UPDATE OF is_primary trigger: when a site is marked is_primary, unsets is_primary on every other site for the same client_id first. Mirrors enforce_single_primary_contact.';

create trigger sites_enforce_single_primary
  before insert or update of is_primary on public.sites
  for each row execute function public.enforce_single_primary_site();

-- Backfill: for every client_id that has at least one site and none
-- currently marked primary, mark its earliest-created site primary. Runs
-- as a plain UPDATE (fires sites_enforce_single_primary harmlessly — there
-- is nothing else already primary for these client_ids by definition).
with candidates as (
  select distinct on (client_id) id, client_id
  from public.sites
  order by client_id, created_at asc
),
clients_without_primary as (
  select client_id
  from public.sites
  group by client_id
  having bool_or(is_primary) = false
)
update public.sites s
set is_primary = true
from candidates c
where s.id = c.id
  and c.client_id in (select client_id from clients_without_primary);

-- ---------------------------------------------------------------------------
-- 3. geocoded_at: companion to the pre-existing latitude/longitude columns,
--    which are repurposed from manual entry to a server-computed geocoding
--    cache (see migration header). No constraint changes to
--    latitude/longitude themselves — comments updated only, for clarity.
-- ---------------------------------------------------------------------------
alter table public.sites
  add column geocoded_at timestamptz;

comment on column public.sites.geocoded_at is
  'When latitude/longitude were last computed by server-side geocoding (lib/geocoding/nominatim.ts) from this site''s address fields. Null if never geocoded (no match, geocoding failed, or the address has changed since the last successful geocode). Written by the createSite/updateSite server action alongside latitude/longitude, not by a DB trigger.';
comment on column public.sites.latitude is
  'WGS84 latitude, nullable. Plain double precision (no PostGIS dependency) — sufficient for map-view pins. Computed server-side by geocoding this site''s address fields (see geocoded_at) rather than entered manually — the pin follows the address, not the other way round. Revisit if geospatial queries (radius search, etc.) are needed later.';
comment on column public.sites.longitude is
  'WGS84 longitude, nullable. See latitude comment.';

-- New columns on an already-locked-down table (revoke-all was already done
-- in 20260822193000_fix_clients_sites_assets_column_grants.sql): plain
-- additive grants only, same reasoning as assets.subtype_id's grant in
-- 20260823090000_contacts_dependent_reference_lists.sql.
grant insert (
  is_visit_address, is_invoice_address, is_delivery_address,
  is_primary, geocoded_at
) on public.sites to authenticated;
grant update (
  is_visit_address, is_invoice_address, is_delivery_address,
  is_primary, geocoded_at
) on public.sites to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Legacy single address on clients: sites is now the sole authoritative
--    multi-address model for a client. Migrate what can be reliably
--    migrated, then drop the flat columns (see migration header for the
--    judgment call on clients that already have sites).
-- ---------------------------------------------------------------------------
insert into public.sites (
  client_id, name,
  address_line1, address_line2, postal_code, city, country,
  is_visit_address, is_invoice_address, is_delivery_address, is_primary
)
select
  c.id,
  'Main address',
  c.address_line1, c.address_line2, c.postal_code, c.city, c.country,
  true, true, true, true
from public.clients c
where c.address_line1 is not null
  and not exists (select 1 from public.sites s where s.client_id = c.id);

alter table public.clients
  drop column address_line1,
  drop column address_line2,
  drop column postal_code,
  drop column city,
  drop column country;
