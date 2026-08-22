-- Clients / Sites / Assets schema + RLS (issue #7, Phase 1 Core CRM).
-- See docs/ARCHITECTURE.md ("Core schema (v1)" and "RBAC matrix").
--
-- Design notes (read before extending):
--
-- 1. `organization_id` denormalization decision: `sites` and `assets` are
--    reached from `organizations` via `clients` (organizations -> clients ->
--    sites -> assets). Rather than write RLS policies that join through
--    `clients` (and, for `assets`, through `sites` AND `clients`) on every
--    row check, both tables carry their own `organization_id` column,
--    kept in sync automatically by a BEFORE INSERT/UPDATE trigger that
--    derives it from the parent row (`sites.organization_id` from
--    `clients.organization_id` via `client_id`; `assets.organization_id`
--    AND `assets.client_id` from `sites` via `site_id`). This means:
--      - Every tenant-scoped table's RLS policy stays the simple,
--        single-column `is_member_of_org(organization_id)` /
--        `is_org_owner(organization_id)` pattern from the baseline
--        migration — no multi-table joins inside a policy, which is both
--        easier to reason about and cheaper to plan/execute.
--      - `api-backend-engineer`: do NOT ask callers to supply
--        `organization_id` (on `sites`) or `client_id`/`organization_id`
--        (on `assets`) — those columns are intentionally NOT in the
--        column-level INSERT/UPDATE grants below (see `revoke`/`grant`
--        blocks), so PostgREST/Supabase-JS inserts that try to set them
--        will be rejected with 42501. Supply `client_id` on `sites` and
--        `site_id` on `assets`; the trigger derives the rest.
--      - The trigger also refuses to let an UPDATE change the derived
--        `organization_id` (i.e. you cannot re-parent a site/asset across
--        organizations by changing `client_id`/`site_id` to point at a
--        different tenant's row) — see `guard_no_cross_org_reparent` below.
--
-- 2. RLS write boundary is intentionally coarse for v1: only `is_org_owner`
--    may INSERT/UPDATE/DELETE on `clients`, `sites`, and `assets`, matching
--    the "Owner: CRUD" column of the RBAC matrix. The matrix also grants
--    Planner "Read/Update" and Engineer "Read/Update (assigned)" on Assets
--    — that finer split is NOT expressed in RLS here; it's an
--    application-layer concern for `lib/rbac/permissions.ts` /
--    `api-backend-engineer` (per the task: "the safe backstop"). Any
--    non-owner write must currently go through a server-side path that
--    itself uses the service-role client after checking `can()` — a plain
--    authenticated Planner/Engineer session cannot UPDATE these tables
--    directly yet. This is a known, deliberate v1 gap for Phase 2
--    (assignment-based scoping) to close, NOT an oversight.
--
-- 3. `created_by` on all three tables is populated by a trigger
--    (`set_created_by`, `auth.uid()`), never client-suppliable — mirrors
--    the column-lockdown pattern already used for
--    `invites.token`/`invites.accepted_at` and `users.is_platform_admin`.

-- ---------------------------------------------------------------------------
-- Shared trigger helpers
-- ---------------------------------------------------------------------------

-- Sets `created_by` to the inserting user; runs before set_updated_at-style
-- defaults so it only ever fires once, on INSERT.
create or replace function public.set_created_by()
returns trigger
language plpgsql
as $$
begin
  new.created_by := auth.uid();
  return new;
end;
$$;

comment on function public.set_created_by() is
  'BEFORE INSERT trigger: stamps created_by = auth.uid(). created_by is deliberately excluded from every client-facing INSERT/UPDATE column grant so it cannot be spoofed.';

-- ---------------------------------------------------------------------------
-- clients: the tenant''s own customer records (their CRM), not the tenant
-- itself.
-- ---------------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  email text,
  phone text,
  address_line1 text,
  address_line2 text,
  postal_code text,
  city text,
  country text,
  notes text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.clients is
  'A tenant''s own customer records (their CRM) — distinct from public.organizations, which is the tenant itself.';

create index clients_organization_id_idx on public.clients (organization_id);
create index clients_created_by_idx on public.clients (created_by);

alter table public.clients enable row level security;
alter table public.clients force row level security;

create trigger clients_set_created_by
  before insert on public.clients
  for each row execute function public.set_created_by();

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- sites: physical locations belonging to a client. organization_id is
-- denormalized from clients.organization_id (see design note 1 above).
-- ---------------------------------------------------------------------------
create table public.sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  name text not null,
  address_line1 text,
  address_line2 text,
  postal_code text,
  city text,
  country text,
  latitude double precision,
  longitude double precision,
  notes text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.sites is
  'A physical location belonging to a client. organization_id is denormalized from clients.organization_id via the derive_site_organization_id trigger, purely so RLS policies here stay a single-column is_member_of_org(organization_id)/is_org_owner(organization_id) check instead of joining through clients.';
comment on column public.sites.organization_id is
  'Denormalized from clients.organization_id (via client_id). Never client-writable — see derive_site_organization_id trigger and the column-level grants below.';
comment on column public.sites.latitude is 'WGS84 latitude, nullable. Plain double precision (no PostGIS dependency) — sufficient for map-view pins; revisit if geospatial queries (radius search, etc.) are needed later.';
comment on column public.sites.longitude is 'WGS84 longitude, nullable. See latitude comment.';

create index sites_organization_id_idx on public.sites (organization_id);
create index sites_client_id_idx on public.sites (client_id);
create index sites_created_by_idx on public.sites (created_by);

alter table public.sites enable row level security;
alter table public.sites force row level security;

-- Derives organization_id from client_id, and refuses to let a re-parent
-- (changing client_id on UPDATE) move the site into a different
-- organization than it already belongs to.
create or replace function public.derive_site_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select c.organization_id into v_org_id
  from public.clients c
  where c.id = new.client_id;

  if v_org_id is null then
    raise exception 'sites.client_id % does not reference an existing client', new.client_id
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from v_org_id then
    raise exception 'Cannot move a site to a client in a different organization'
      using errcode = '23514';
  end if;

  new.organization_id := v_org_id;
  return new;
end;
$$;

comment on function public.derive_site_organization_id() is
  'BEFORE INSERT/UPDATE OF client_id trigger on public.sites: sets organization_id from the referenced client, and blocks cross-organization re-parenting. SECURITY DEFINER so it can read clients regardless of the caller''s own RLS grants on that table (the caller is already required to be is_org_owner of the resulting organization via the sites RLS policy, which is evaluated with check AFTER this trigger runs).';

create trigger sites_derive_organization_id
  before insert or update of client_id on public.sites
  for each row execute function public.derive_site_organization_id();

create trigger sites_set_created_by
  before insert on public.sites
  for each row execute function public.set_created_by();

create trigger sites_set_updated_at
  before update on public.sites
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- assets: physical equipment installed at a site. client_id AND
-- organization_id are both denormalized from site_id (see design note 1).
-- ---------------------------------------------------------------------------
create type public.asset_status as enum ('active', 'decommissioned');

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete cascade,
  name text not null,
  type text not null,
  manufacturer text,
  model text,
  serial_number text,
  status public.asset_status not null default 'active',
  installed_at date,
  warranty_until date,
  notes text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.assets is
  'Physical equipment installed at a site. client_id and organization_id are both denormalized from site_id (via derive_asset_org_and_client trigger) purely for simple, single-column RLS — the source of truth for "which client/org does this asset belong to" is always its site.';
comment on column public.assets.client_id is
  'Denormalized from sites.client_id (via site_id). Never client-writable — see derive_asset_org_and_client trigger and the column-level grants below.';
comment on column public.assets.organization_id is
  'Denormalized from sites.organization_id (via site_id, which is itself denormalized from clients.organization_id). Never client-writable.';

create index assets_organization_id_idx on public.assets (organization_id);
create index assets_client_id_idx on public.assets (client_id);
create index assets_site_id_idx on public.assets (site_id);
create index assets_created_by_idx on public.assets (created_by);
create index assets_serial_number_idx on public.assets (serial_number);

alter table public.assets enable row level security;
alter table public.assets force row level security;

create or replace function public.derive_asset_org_and_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_org_id uuid;
begin
  select s.client_id, s.organization_id into v_client_id, v_org_id
  from public.sites s
  where s.id = new.site_id;

  if v_org_id is null then
    raise exception 'assets.site_id % does not reference an existing site', new.site_id
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from v_org_id then
    raise exception 'Cannot move an asset to a site in a different organization'
      using errcode = '23514';
  end if;

  new.client_id := v_client_id;
  new.organization_id := v_org_id;
  return new;
end;
$$;

comment on function public.derive_asset_org_and_client() is
  'BEFORE INSERT/UPDATE OF site_id trigger on public.assets: sets client_id and organization_id from the referenced site, and blocks cross-organization re-parenting. SECURITY DEFINER so it can read sites regardless of the caller''s own RLS grants (the caller is already required to be is_org_owner of the resulting organization via the assets RLS policy, evaluated with check AFTER this trigger runs).';

create trigger assets_derive_org_and_client
  before insert or update of site_id on public.assets
  for each row execute function public.derive_asset_org_and_client();

create trigger assets_set_created_by
  before insert on public.assets
  for each row execute function public.set_created_by();

create trigger assets_set_updated_at
  before update on public.assets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS policies: clients
-- Read: any org member. Write: owner only (see design note 2).
-- ---------------------------------------------------------------------------
create policy "clients_select_member"
on public.clients
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "clients_insert_owner"
on public.clients
for insert
to authenticated
with check (public.is_org_owner(organization_id));

create policy "clients_update_owner"
on public.clients
for update
to authenticated
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

create policy "clients_delete_owner"
on public.clients
for delete
to authenticated
using (public.is_org_owner(organization_id));

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
-- RLS policies: sites
-- Read: any org member. Write: owner only (see design note 2).
-- ---------------------------------------------------------------------------
create policy "sites_select_member"
on public.sites
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "sites_insert_owner"
on public.sites
for insert
to authenticated
with check (public.is_org_owner(organization_id));

create policy "sites_update_owner"
on public.sites
for update
to authenticated
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

create policy "sites_delete_owner"
on public.sites
for delete
to authenticated
using (public.is_org_owner(organization_id));

grant select, delete on public.sites to authenticated;
-- organization_id intentionally excluded: derived by derive_site_organization_id.
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
-- RLS policies: assets
-- Read: any org member. Write: owner only (see design note 2 — Planner's
-- "Read/Update" and Engineer's "Read/Update (assigned)" from the RBAC
-- matrix are NOT yet expressible in RLS and remain an application-layer /
-- Phase 2 concern).
-- ---------------------------------------------------------------------------
create policy "assets_select_member"
on public.assets
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "assets_insert_owner"
on public.assets
for insert
to authenticated
with check (public.is_org_owner(organization_id));

create policy "assets_update_owner"
on public.assets
for update
to authenticated
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

create policy "assets_delete_owner"
on public.assets
for delete
to authenticated
using (public.is_org_owner(organization_id));

grant select, delete on public.assets to authenticated;
-- client_id / organization_id intentionally excluded: derived by
-- derive_asset_org_and_client.
grant insert (
  site_id, name, type, manufacturer, model, serial_number,
  status, installed_at, warranty_until, notes
) on public.assets to authenticated;
grant update (
  site_id, name, type, manufacturer, model, serial_number,
  status, installed_at, warranty_until, notes
) on public.assets to authenticated;
