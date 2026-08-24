-- Quotes / Estimates module (issue #16, Phase 3 — "pre-sale proposal
-- builder with templates/pricing rules, convert to a Work Order/contract on
-- customer approval"). See docs/ARCHITECTURE.md ("Core schema (v1)", RBAC
-- matrix) and docs/ROADMAP.md ("Phase 3").
--
-- This is the FIFTH table (after work_orders, contracts, time_entries,
-- checklists) whose RBAC matrix row is enforced as real RLS via
-- `current_member_role`, reusing the exact `work_orders` shape (owner/planner
-- CRUD, everyone else read-only, no per-row assignment scoping — a quote is a
-- sales document any team member can see, unlike a Work Order's
-- assigned-engineer scoping) rather than `contracts`' owner+finance shape: a
-- quote is a pre-sale proposal, not yet revenue, so it sits at Work Orders'
-- ops tier, not Contracts' finance tier.
--
-- Design notes (read before extending):
--
-- 1. `quotes.organization_id` denormalization: same pattern as
--    `sites`/`contacts`/`work_orders`/`contracts` — denormalized from
--    `clients.organization_id` via `client_id` (`derive_quote_organization_id`),
--    which also fills in the organization's default `quote_status` item when
--    `status_id` is omitted on insert, folded in for the same
--    trigger-ordering reason `work_orders.status_id`'s default was folded
--    into `derive_work_order_organization_id`.
--
-- 2. **No stored total.** `quotes` deliberately has NO `total`/`amount`
--    column. A quote's total is `sum(quantity * unit_price)` over its
--    `quote_line_items` — cheap to compute on read (a single aggregate query,
--    or a view/RPC `api-backend-engineer` can add), so there is no
--    sync-trigger keeping a redundant stored value correct every time a line
--    item is inserted/updated/deleted. This is a deliberate omission, not an
--    oversight: a future pass should NOT "fix" this by adding a stored
--    `quotes.total` column + maintenance trigger — that would only
--    reintroduce the exact denormalization-drift risk this design avoided.
--    If a stored/cached total is ever genuinely needed (e.g. for sorting a
--    huge quotes list without an aggregate join), that's a deliberate,
--    separately-reviewed decision, not a silent "obviously missing" patch.
--
-- 3. `quotes.site_id` is nullable (a quote may or may not be tied to one
--    specific location) but, when set, must belong to `client_id` — same
--    cross-field style as `work_orders.site_id`, checked by
--    `validate_quote_relations`.
--
-- 4. `quote_line_items.asset_id` is nullable (optional context link, e.g.
--    "this line item is for servicing this specific asset") but, when set,
--    must belong to the QUOTE's own `client_id` — mirrors
--    `contract_assets`' asset/contract client-match check
--    (`validate_contract_asset_relations`), just expressed as a column on the
--    line item itself rather than a join-table row. Checked by
--    `validate_quote_line_item_relations`.
--
-- 5. `quote_line_items.quote_id` is immutable after creation (excluded from
--    the UPDATE column grant) — same "no re-parenting, delete + re-insert
--    instead" stance as `reference_list_items.reference_list_id` /
--    `checklist_template_items.checklist_template_id`. The
--    derive/validate-on-`quote_id` trigger branches are defense-in-depth
--    backstops (unreachable via the column grant), same pattern as those
--    precedents.
--
-- 6. Traceability from conversion: `work_orders.source_quote_id` and
--    `contracts.source_quote_id` (both nullable FKs into `quotes`, added
--    here as plain additive columns on existing, already-locked-down
--    tables — no `revoke all` needed, same non-issue as
--    `work_orders.contract_id` before it) trace a Work Order/Contract created
--    by converting an accepted quote back to that quote. When set, each must
--    belong to the same `client_id` as the work order/contract —
--    `validate_work_order_relations` is extended (CREATE OR REPLACE) with
--    this check; `contracts` gets a brand-new `validate_contract_relations`
--    trigger for it (contracts had no relations-style trigger before this —
--    only `validate_contract_reference_items` for its reference-list FKs).
--    The actual "convert this quote into a Work Order/Contract" business
--    logic (copying line items, setting status, etc.) is application-layer,
--    out of scope here — this migration only builds the schema/RLS/
--    traceability column.
--
-- Column-grant lockdown: `quotes`/`quote_line_items` are new tables, so the
-- usual "this project's public schema grants ALL to authenticated/anon by
-- default on new tables" gotcha applies — `revoke all` before the explicit
-- grants. `id` is included in both tables' INSERT grants (not omitted), per
-- the reasoning documented in 20260823120000_work_orders_core.sql's grant
-- block: this migration's own RLS test explicitly assigns deterministic
-- fixture ids on insert.

-- ---------------------------------------------------------------------------
-- quotes: the proposal header. organization_id is denormalized from
-- clients.organization_id via client_id (see design note 1 above).
-- ---------------------------------------------------------------------------
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  site_id uuid references public.sites (id) on delete set null,
  name text not null,
  status_id uuid not null references public.reference_list_items (id),
  valid_until date,
  notes text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.quotes is
  'Pre-sale proposal header (issue #16, Phase 3). organization_id is denormalized from clients.organization_id (via client_id) by derive_quote_organization_id, same reasoning as sites/contacts/work_orders/contracts. Deliberately has NO stored total column — a quote''s total is sum(quantity * unit_price) over quote_line_items, computed on read at the application layer, not synced via trigger (see design note 2 in 20260824090000_quotes_core.sql). Do not "fix" this by adding a stored total.';
comment on column public.quotes.organization_id is
  'Denormalized from clients.organization_id (via client_id). Never client-writable — see derive_quote_organization_id trigger and the column-level grants below.';
comment on column public.quotes.site_id is
  'Nullable — a quote may or may not be tied to one specific location. When set, must belong to the same client_id (validated by validate_quote_relations), same cross-field style as work_orders.site_id.';
comment on column public.quotes.name is
  'Human-readable quote name/number (e.g. "Q-2026-014 HVAC Replacement Proposal") — not auto-generated.';
comment on column public.quotes.status_id is
  'FK into reference_list_items for this organization''s quote_status list (Draft [default] -> Sent -> Accepted / Rejected / Expired). Not null; defaults to the org''s default quote_status item when omitted on insert (see derive_quote_organization_id). Validated by validate_quote_reference_items.';
comment on column public.quotes.valid_until is
  'Nullable — the date this quote''s pricing is no longer guaranteed. No check constraint against created_at: a quote can legitimately be created with an already-past valid_until (e.g. backdated data entry), and "expired" is represented by status_id, not derived from this date.';

create index quotes_organization_id_idx on public.quotes (organization_id);
create index quotes_client_id_idx on public.quotes (client_id);
create index quotes_site_id_idx on public.quotes (site_id);
create index quotes_status_id_idx on public.quotes (status_id);
create index quotes_created_by_idx on public.quotes (created_by);
create index quotes_valid_until_idx on public.quotes (valid_until);

alter table public.quotes enable row level security;
alter table public.quotes force row level security;

-- Derives organization_id from client_id (blocking cross-organization
-- re-parenting, same as derive_work_order_organization_id/
-- derive_contract_organization_id), and fills in the organization's default
-- quote_status item when status_id is omitted on insert — folded into this
-- trigger for the same trigger-ordering reason work_orders.status_id's
-- default was folded into derive_work_order_organization_id: organization_id
-- must be known first.
create or replace function public.derive_quote_organization_id()
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
    raise exception 'quotes.client_id % does not reference an existing client', new.client_id
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from v_org_id then
    raise exception 'Cannot move a quote to a client in a different organization'
      using errcode = '23514';
  end if;

  new.organization_id := v_org_id;

  if new.status_id is null then
    select rli.id into new.status_id
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rl.organization_id = v_org_id
      and rl.list_key = 'quote_status'
      and rli.is_default
    limit 1;
  end if;

  return new;
end;
$$;

comment on function public.derive_quote_organization_id() is
  'BEFORE INSERT/UPDATE OF client_id trigger on public.quotes: sets organization_id from the referenced client, blocks cross-organization re-parenting, and fills in status_id with the organization''s default quote_status item when the caller omitted it. Runs before validate_quote_relations/validate_quote_reference_items (alphabetically earlier trigger name, same timing), so organization_id and status_id are already final by the time those run.';

create trigger quotes_derive_organization_id
  before insert or update of client_id on public.quotes
  for each row execute function public.derive_quote_organization_id();

-- Cross-field consistency: site_id (if set) must belong to the quote's own
-- client_id. SECURITY DEFINER so it can resolve the referenced site
-- regardless of the caller's own RLS visibility (mirrors
-- validate_work_order_relations' reasoning).
create or replace function public.validate_quote_relations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_client_id uuid;
begin
  if new.site_id is not null then
    select s.client_id into v_site_client_id
    from public.sites s
    where s.id = new.site_id;

    if v_site_client_id is null then
      raise exception 'quotes.site_id % does not reference an existing site', new.site_id
        using errcode = '23503';
    elsif v_site_client_id <> new.client_id then
      raise exception 'quotes.site_id must belong to the same client as the quote'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_quote_relations() is
  'BEFORE INSERT/UPDATE OF client_id, site_id trigger on public.quotes: rejects a site_id from a different client than the quote''s own client_id. Runs after quotes_derive_organization_id (alphabetically later trigger name, same timing), so new.organization_id is already final.';

create trigger quotes_validate_relations
  before insert or update of client_id, site_id on public.quotes
  for each row execute function public.validate_quote_relations();

-- Validates that status_id points at an item from the correct list_key, in
-- the quote's own organization. Same structural style as
-- validate_work_order_reference_items.
create or replace function public.validate_quote_reference_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status_org uuid;
  v_status_key text;
begin
  if new.status_id is not null then
    select rl.organization_id, rl.list_key into v_status_org, v_status_key
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.status_id;

    if v_status_org is null then
      raise exception 'quotes.status_id % does not reference an existing reference_list_items row', new.status_id
        using errcode = '23503';
    elsif v_status_key <> 'quote_status' then
      raise exception 'quotes.status_id must reference an item from the quote_status reference list (got list_key=%)', v_status_key
        using errcode = '23514';
    elsif v_status_org <> new.organization_id then
      raise exception 'quotes.status_id must belong to the same organization as the quote'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_quote_reference_items() is
  'BEFORE INSERT/UPDATE OF status_id trigger on public.quotes: rejects an item from the wrong list_key or a different organization''s reference list. Runs after quotes_derive_organization_id (alphabetically later trigger name, same timing), so new.organization_id (and the default-filled status_id) are already final.';

create trigger quotes_validate_reference_items
  before insert or update of status_id on public.quotes
  for each row execute function public.validate_quote_reference_items();

create trigger quotes_set_created_by
  before insert on public.quotes
  for each row execute function public.set_created_by();

create trigger quotes_set_updated_at
  before update on public.quotes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS policies: quotes — a NEW module in the RBAC matrix
-- (lib/rbac/permissions.ts's future `quotes` entry — see the migration
-- header and this migration's hand-off notes), reusing work_orders' exact
-- shape:
--   owner:    CRUD, all rows
--   planner:  CRUD, all rows
--   engineer/finance/administratie: SELECT only, all rows (no per-row
--             assignment scoping — a quote isn't "assigned" to one engineer,
--             it's a sales document any team member can see)
-- ---------------------------------------------------------------------------

create policy "quotes_select_member"
on public.quotes
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "quotes_insert_owner_or_planner"
on public.quotes
for insert
to authenticated
with check (
  public.current_member_role(organization_id) in ('owner', 'planner')
);

create policy "quotes_update_owner_or_planner"
on public.quotes
for update
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'planner')
)
with check (
  public.current_member_role(organization_id) in ('owner', 'planner')
);

create policy "quotes_delete_owner_or_planner"
on public.quotes
for delete
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'planner')
);

-- New table: this project's public schema grants ALL privileges to
-- authenticated/anon by default on every newly created table — always
-- revoke first (see 20260822193000_fix_clients_sites_assets_column_grants.sql).
revoke all on public.quotes from authenticated;

grant select, delete on public.quotes to authenticated;
-- organization_id intentionally excluded: derived by
-- derive_quote_organization_id. created_by intentionally excluded: stamped
-- by set_created_by. `id` IS included in the INSERT grant (see migration
-- header note) since this migration's own RLS test explicitly assigns
-- deterministic fixture ids on insert.
grant insert (
  id, client_id, site_id, name, status_id, valid_until, notes
) on public.quotes to authenticated;
grant update (
  client_id, site_id, name, status_id, valid_until, notes
) on public.quotes to authenticated;

-- ---------------------------------------------------------------------------
-- quote_line_items: the pricing rules within a quote. organization_id is
-- denormalized from the QUOTE (not the asset). quote_id is immutable after
-- creation (see design note 5 above).
-- ---------------------------------------------------------------------------
create table public.quote_line_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  asset_id uuid references public.assets (id) on delete set null,
  description text not null,
  quantity numeric(10, 2) not null default 1,
  unit_price numeric(12, 2) not null default 0,
  sort_order integer not null default 0,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.quote_line_items is
  'A priced line item within a quotes proposal. organization_id is denormalized from quotes.organization_id (via quote_id) by derive_quote_line_item_organization_id. No stored line total either (quantity * unit_price is computed on read, same design decision as quotes'' own missing total column — see design note 2 in 20260824090000_quotes_core.sql). quote_id is immutable after creation (excluded from the UPDATE grant) — delete + re-insert to move a line item to a different quote, same stance as reference_list_items.reference_list_id.';
comment on column public.quote_line_items.organization_id is
  'Denormalized from quotes.organization_id (via quote_id). Never client-writable — see derive_quote_line_item_organization_id trigger and the column-level grants below.';
comment on column public.quote_line_items.asset_id is
  'Nullable — optional context link, e.g. "this line item is for servicing this specific asset". When set, must belong to the QUOTE''s own client_id (validated by validate_quote_line_item_relations), mirroring contract_assets'' asset/contract client-match check.';
comment on column public.quote_line_items.quantity is
  'numeric(10,2), defaults to 1. Combined with unit_price at the application layer (never stored) to compute this line''s subtotal and the quote''s overall total.';
comment on column public.quote_line_items.unit_price is
  'numeric(12,2) — same money precision as everywhere else in this schema (contracts.value, etc.), defaults to 0.';

create index quote_line_items_quote_id_idx on public.quote_line_items (quote_id);
create index quote_line_items_organization_id_idx on public.quote_line_items (organization_id);
create index quote_line_items_asset_id_idx on public.quote_line_items (asset_id);
create index quote_line_items_created_by_idx on public.quote_line_items (created_by);
create index quote_line_items_quote_sort_idx on public.quote_line_items (quote_id, sort_order);

alter table public.quote_line_items enable row level security;
alter table public.quote_line_items force row level security;

-- Derives organization_id from quote_id (blocking cross-organization
-- re-parenting). quote_id is excluded from the UPDATE column grant (design
-- note 5), so the UPDATE branch here is a defense-in-depth backstop, same
-- pattern as derive_checklist_template_item_org.
create or replace function public.derive_quote_line_item_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select q.organization_id into v_org_id
  from public.quotes q
  where q.id = new.quote_id;

  if v_org_id is null then
    raise exception 'quote_line_items.quote_id % does not reference an existing quote', new.quote_id
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from v_org_id then
    raise exception 'Cannot move a quote line item to a quote in a different organization'
      using errcode = '23514';
  end if;

  new.organization_id := v_org_id;
  return new;
end;
$$;

comment on function public.derive_quote_line_item_organization_id() is
  'BEFORE INSERT/UPDATE OF quote_id trigger on public.quote_line_items: sets organization_id from the referenced quote, and blocks cross-organization re-parenting. quote_id is excluded from the UPDATE column grant (see design note 5 in 20260824090000_quotes_core.sql), so the UPDATE branch here is a defense-in-depth backstop.';

create trigger quote_line_items_derive_organization_id
  before insert or update of quote_id on public.quote_line_items
  for each row execute function public.derive_quote_line_item_organization_id();

-- Cross-field consistency: asset_id (if set) must belong to the SAME client
-- as the quote itself (looked up via quote_id), mirroring
-- validate_contract_asset_relations' asset/contract client-match check.
-- SECURITY DEFINER so it can resolve the referenced quote/asset regardless of
-- the caller's own RLS visibility.
create or replace function public.validate_quote_line_item_relations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote_client_id uuid;
  v_asset_client_id uuid;
begin
  if new.asset_id is not null then
    select client_id into v_quote_client_id
    from public.quotes
    where id = new.quote_id;

    select client_id into v_asset_client_id
    from public.assets
    where id = new.asset_id;

    if v_asset_client_id is null then
      raise exception 'quote_line_items.asset_id % does not reference an existing asset', new.asset_id
        using errcode = '23503';
    elsif v_asset_client_id <> v_quote_client_id then
      raise exception 'quote_line_items.asset_id must belong to the same client as the quote'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_quote_line_item_relations() is
  'BEFORE INSERT/UPDATE OF quote_id, asset_id trigger on public.quote_line_items: rejects an asset_id belonging to a different client than the quote''s own client_id. quote_id is excluded from the UPDATE column grant (see design note 5), so the quote_id branch of this trigger''s WHEN clause is a defense-in-depth backstop. Runs after quote_line_items_derive_organization_id (alphabetically later trigger name, same timing), so new.organization_id is already final.';

create trigger quote_line_items_validate_relations
  before insert or update of quote_id, asset_id on public.quote_line_items
  for each row execute function public.validate_quote_line_item_relations();

create trigger quote_line_items_set_created_by
  before insert on public.quote_line_items
  for each row execute function public.set_created_by();

create trigger quote_line_items_set_updated_at
  before update on public.quote_line_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS policies: quote_line_items — same owner-or-planner write boundary as
-- quotes itself ("if you can manage the quote, you can manage its line
-- items").
-- ---------------------------------------------------------------------------

create policy "quote_line_items_select_member"
on public.quote_line_items
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "quote_line_items_insert_owner_or_planner"
on public.quote_line_items
for insert
to authenticated
with check (
  public.current_member_role(organization_id) in ('owner', 'planner')
);

create policy "quote_line_items_update_owner_or_planner"
on public.quote_line_items
for update
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'planner')
)
with check (
  public.current_member_role(organization_id) in ('owner', 'planner')
);

create policy "quote_line_items_delete_owner_or_planner"
on public.quote_line_items
for delete
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'planner')
);

revoke all on public.quote_line_items from authenticated;

grant select, delete on public.quote_line_items to authenticated;
-- organization_id intentionally excluded: derived by
-- derive_quote_line_item_organization_id. created_by intentionally excluded:
-- stamped by set_created_by. quote_id is accepted on INSERT only (immutable
-- thereafter — see design note 5): no UPDATE grant for it.
grant insert (
  id, quote_id, asset_id, description, quantity, unit_price, sort_order
) on public.quote_line_items to authenticated;
grant update (
  asset_id, description, quantity, unit_price, sort_order
) on public.quote_line_items to authenticated;

-- ---------------------------------------------------------------------------
-- work_orders.source_quote_id / contracts.source_quote_id: traceability from
-- conversion (design note 6 above). Plain additive columns on existing,
-- already-locked-down tables — no `revoke all` needed (ALTER TABLE ADD
-- COLUMN doesn't inherit the "revoke all on new tables" gotcha), same
-- non-issue as work_orders.contract_id before it.
-- ---------------------------------------------------------------------------
alter table public.work_orders
  add column source_quote_id uuid references public.quotes (id) on delete set null;

comment on column public.work_orders.source_quote_id is
  'Nullable FK into quotes — the accepted quote this work order was created by converting, if any. When set, must belong to the same client_id as the work order (validated by validate_work_order_relations, same cross-field spirit as the existing site_id/asset_id/contract_id checks). The actual quote-to-work-order conversion logic (copying line items etc.) is application-layer, out of scope here.';

create index work_orders_source_quote_id_idx on public.work_orders (source_quote_id);

alter table public.contracts
  add column source_quote_id uuid references public.quotes (id) on delete set null;

comment on column public.contracts.source_quote_id is
  'Nullable FK into quotes — the accepted quote this contract was created by converting, if any. When set, must belong to the same client_id as the contract (validated by the new validate_contract_relations trigger below). The actual quote-to-contract conversion logic is application-layer, out of scope here.';

create index contracts_source_quote_id_idx on public.contracts (source_quote_id);

-- Extend (CREATE OR REPLACE, not a parallel trigger) validate_work_order_relations
-- with the source_quote_id <-> client_id cross-field check, and widen the
-- trigger's column list to include source_quote_id.
create or replace function public.validate_work_order_relations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_site_client_id uuid;
  v_asset_client_id uuid;
  v_asset_site_id uuid;
  v_assigned_is_member boolean;
  v_contract_client_id uuid;
  v_source_quote_client_id uuid;
begin
  if new.site_id is not null then
    select s.client_id into v_site_client_id
    from public.sites s
    where s.id = new.site_id;

    if v_site_client_id is null then
      raise exception 'work_orders.site_id % does not reference an existing site', new.site_id
        using errcode = '23503';
    elsif v_site_client_id <> new.client_id then
      raise exception 'work_orders.site_id must belong to the same client as the work order'
        using errcode = '23514';
    end if;
  end if;

  if new.asset_id is not null then
    select a.client_id, a.site_id into v_asset_client_id, v_asset_site_id
    from public.assets a
    where a.id = new.asset_id;

    if v_asset_client_id is null then
      raise exception 'work_orders.asset_id % does not reference an existing asset', new.asset_id
        using errcode = '23503';
    elsif v_asset_client_id <> new.client_id then
      raise exception 'work_orders.asset_id must belong to the same client as the work order'
        using errcode = '23514';
    elsif new.site_id is not null and v_asset_site_id <> new.site_id then
      raise exception 'work_orders.asset_id must belong to the same site as the work order (when site_id is set)'
        using errcode = '23514';
    end if;
  end if;

  if new.assigned_to is not null then
    select exists (
      select 1
      from public.memberships m
      where m.user_id = new.assigned_to
        and m.organization_id = new.organization_id
    ) into v_assigned_is_member;

    if not v_assigned_is_member then
      raise exception 'work_orders.assigned_to must be a member of the same organization as the work order'
        using errcode = '23514';
    end if;
  end if;

  if new.contract_id is not null then
    select client_id into v_contract_client_id
    from public.contracts
    where id = new.contract_id;

    if v_contract_client_id is null then
      raise exception 'work_orders.contract_id % does not reference an existing contract', new.contract_id
        using errcode = '23503';
    elsif v_contract_client_id <> new.client_id then
      raise exception 'work_orders.contract_id must belong to the same client as the work order'
        using errcode = '23514';
    end if;
  end if;

  if new.source_quote_id is not null then
    select client_id into v_source_quote_client_id
    from public.quotes
    where id = new.source_quote_id;

    if v_source_quote_client_id is null then
      raise exception 'work_orders.source_quote_id % does not reference an existing quote', new.source_quote_id
        using errcode = '23503';
    elsif v_source_quote_client_id <> new.client_id then
      raise exception 'work_orders.source_quote_id must belong to the same client as the work order'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_work_order_relations() is
  'BEFORE INSERT/UPDATE OF client_id, site_id, asset_id, assigned_to, contract_id, source_quote_id trigger on public.work_orders: rejects a site_id/asset_id/contract_id/source_quote_id from a different client than the work order''s own client_id, an asset_id from a different site than the work order''s own site_id (when both are set), and an assigned_to user who is not a member of the work order''s own organization. Extended in 20260824090000_quotes_core.sql with the source_quote_id check. Runs after derive_work_order_organization_id (alphabetically later trigger name, same timing), so new.organization_id is already final.';

drop trigger if exists work_orders_validate_relations on public.work_orders;

create trigger work_orders_validate_relations
  before insert or update of client_id, site_id, asset_id, assigned_to, contract_id, source_quote_id on public.work_orders
  for each row execute function public.validate_work_order_relations();

grant insert (source_quote_id) on public.work_orders to authenticated;
grant update (source_quote_id) on public.work_orders to authenticated;

-- Brand-new trigger on contracts (contracts previously had no
-- relations-style cross-field trigger — only validate_contract_reference_items
-- for its reference-list FKs). Checks source_quote_id's client_id against the
-- contract's own client_id, same shape as work_orders.source_quote_id's check
-- above.
create or replace function public.validate_contract_relations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_quote_client_id uuid;
begin
  if new.source_quote_id is not null then
    select client_id into v_source_quote_client_id
    from public.quotes
    where id = new.source_quote_id;

    if v_source_quote_client_id is null then
      raise exception 'contracts.source_quote_id % does not reference an existing quote', new.source_quote_id
        using errcode = '23503';
    elsif v_source_quote_client_id <> new.client_id then
      raise exception 'contracts.source_quote_id must belong to the same client as the contract'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_contract_relations() is
  'BEFORE INSERT/UPDATE OF client_id, source_quote_id trigger on public.contracts: rejects a source_quote_id from a different client than the contract''s own client_id. New as of 20260824090000_quotes_core.sql — contracts had no relations-style cross-field trigger before this (only validate_contract_reference_items, for its reference-list FKs). Runs after contracts_derive_organization_id (alphabetically later trigger name, same timing), so new.organization_id is already final.';

create trigger contracts_validate_relations
  before insert or update of client_id, source_quote_id on public.contracts
  for each row execute function public.validate_contract_relations();

grant insert (source_quote_id) on public.contracts to authenticated;
grant update (source_quote_id) on public.contracts to authenticated;

-- ---------------------------------------------------------------------------
-- Reference list: quote_status. Flat list (no parent_list_key), extending
-- seed_default_reference_lists per its documented extension pattern rather
-- than a new seeding mechanism.
-- ---------------------------------------------------------------------------
create or replace function public.seed_default_reference_lists(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset_type_list_id uuid;
  v_asset_status_list_id uuid;
  v_contact_role_list_id uuid;
  v_asset_subtype_list_id uuid;
  v_hvac_id uuid;
  v_electrical_id uuid;
  v_plumbing_id uuid;
  v_generator_id uuid;
  v_other_id uuid;
  v_work_order_status_list_id uuid;
  v_work_order_priority_list_id uuid;
  v_contract_type_list_id uuid;
  v_sla_tier_list_id uuid;
  v_billing_terms_list_id uuid;
  v_maintenance_id uuid;
  v_service_id uuid;
  v_installation_id uuid;
  v_warranty_id uuid;
  v_time_entry_type_list_id uuid;
  v_quote_status_list_id uuid;
begin
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'asset_type', 'Asset Type')
  on conflict (organization_id, list_key) do nothing;

  select id into v_asset_type_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'asset_type';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_asset_type_list_id, p_organization_id, 'hvac', 'HVAC', 1, false),
    (v_asset_type_list_id, p_organization_id, 'electrical', 'Electrical', 2, false),
    (v_asset_type_list_id, p_organization_id, 'plumbing', 'Plumbing', 3, false),
    (v_asset_type_list_id, p_organization_id, 'generator', 'Generator', 4, false),
    (v_asset_type_list_id, p_organization_id, 'other', 'Other', 5, true)
  on conflict (reference_list_id, value) do nothing;

  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'asset_status', 'Asset Status')
  on conflict (organization_id, list_key) do nothing;

  select id into v_asset_status_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'asset_status';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default, color)
  values
    (v_asset_status_list_id, p_organization_id, 'active', 'Active', 1, true, 'green'),
    (v_asset_status_list_id, p_organization_id, 'in_repair', 'In Repair', 2, false, 'amber'),
    (v_asset_status_list_id, p_organization_id, 'decommissioned', 'Decommissioned', 3, false, 'gray')
  on conflict (reference_list_id, value) do nothing;

  -- contact_role: for contacts.role_item_id. Not a dependent list — flat,
  -- like asset_type/asset_status.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'contact_role', 'Contact Role')
  on conflict (organization_id, list_key) do nothing;

  select id into v_contact_role_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'contact_role';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_contact_role_list_id, p_organization_id, 'primary', 'Primary', 1, true),
    (v_contact_role_list_id, p_organization_id, 'billing', 'Billing', 2, false),
    (v_contact_role_list_id, p_organization_id, 'site_manager', 'Site manager', 3, false),
    (v_contact_role_list_id, p_organization_id, 'technical', 'Technical', 4, false)
  on conflict (reference_list_id, value) do nothing;

  -- asset_subtype: pilot dependent list, parent_list_key = asset_type. Each
  -- item's parent_item_id points at the matching asset_type item just
  -- seeded/looked-up above, in this same organization.
  insert into public.reference_lists (organization_id, list_key, name, parent_list_key)
  values (p_organization_id, 'asset_subtype', 'Asset Sub-type', 'asset_type')
  on conflict (organization_id, list_key) do nothing;

  select id into v_asset_subtype_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'asset_subtype';

  select id into v_hvac_id from public.reference_list_items where reference_list_id = v_asset_type_list_id and value = 'hvac';
  select id into v_electrical_id from public.reference_list_items where reference_list_id = v_asset_type_list_id and value = 'electrical';
  select id into v_plumbing_id from public.reference_list_items where reference_list_id = v_asset_type_list_id and value = 'plumbing';
  select id into v_generator_id from public.reference_list_items where reference_list_id = v_asset_type_list_id and value = 'generator';
  select id into v_other_id from public.reference_list_items where reference_list_id = v_asset_type_list_id and value = 'other';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, parent_item_id)
  values
    (v_asset_subtype_list_id, p_organization_id, 'compressor', 'Compressor', 1, v_hvac_id),
    (v_asset_subtype_list_id, p_organization_id, 'thermostat', 'Thermostat', 2, v_hvac_id),
    (v_asset_subtype_list_id, p_organization_id, 'ductwork', 'Ductwork', 3, v_hvac_id),
    (v_asset_subtype_list_id, p_organization_id, 'panel', 'Panel', 4, v_electrical_id),
    (v_asset_subtype_list_id, p_organization_id, 'wiring', 'Wiring', 5, v_electrical_id),
    (v_asset_subtype_list_id, p_organization_id, 'lighting', 'Lighting', 6, v_electrical_id),
    (v_asset_subtype_list_id, p_organization_id, 'pipe', 'Pipe', 7, v_plumbing_id),
    (v_asset_subtype_list_id, p_organization_id, 'valve', 'Valve', 8, v_plumbing_id),
    (v_asset_subtype_list_id, p_organization_id, 'pump', 'Pump', 9, v_plumbing_id),
    (v_asset_subtype_list_id, p_organization_id, 'engine', 'Engine', 10, v_generator_id),
    (v_asset_subtype_list_id, p_organization_id, 'transfer_switch', 'Transfer switch', 11, v_generator_id),
    (v_asset_subtype_list_id, p_organization_id, 'other_subtype', 'Other', 12, v_other_id)
  on conflict (reference_list_id, value) do nothing;

  -- work_order_status: for work_orders.status_id. Flat list, ordered
  -- lifecycle: New (default) -> Scheduled -> En Route -> In Progress ->
  -- Completed -> Invoiced.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'work_order_status', 'Work Order Status')
  on conflict (organization_id, list_key) do nothing;

  select id into v_work_order_status_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'work_order_status';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_work_order_status_list_id, p_organization_id, 'new', 'New', 1, true),
    (v_work_order_status_list_id, p_organization_id, 'scheduled', 'Scheduled', 2, false),
    (v_work_order_status_list_id, p_organization_id, 'en_route', 'En Route', 3, false),
    (v_work_order_status_list_id, p_organization_id, 'in_progress', 'In Progress', 4, false),
    (v_work_order_status_list_id, p_organization_id, 'completed', 'Completed', 5, false),
    (v_work_order_status_list_id, p_organization_id, 'invoiced', 'Invoiced', 6, false)
  on conflict (reference_list_id, value) do nothing;

  -- work_order_priority: for work_orders.priority_id. Flat list.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'work_order_priority', 'Work Order Priority')
  on conflict (organization_id, list_key) do nothing;

  select id into v_work_order_priority_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'work_order_priority';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_work_order_priority_list_id, p_organization_id, 'low', 'Low', 1, false),
    (v_work_order_priority_list_id, p_organization_id, 'normal', 'Normal', 2, true),
    (v_work_order_priority_list_id, p_organization_id, 'high', 'High', 3, false),
    (v_work_order_priority_list_id, p_organization_id, 'urgent', 'Urgent', 4, false)
  on conflict (reference_list_id, value) do nothing;

  -- contract_type: for contracts.type_id. Flat list.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'contract_type', 'Contract Type')
  on conflict (organization_id, list_key) do nothing;

  select id into v_contract_type_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'contract_type';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_contract_type_list_id, p_organization_id, 'maintenance', 'Maintenance', 1, true),
    (v_contract_type_list_id, p_organization_id, 'service', 'Service', 2, false),
    (v_contract_type_list_id, p_organization_id, 'installation', 'Installation', 3, false),
    (v_contract_type_list_id, p_organization_id, 'warranty', 'Warranty', 4, false)
  on conflict (reference_list_id, value) do nothing;

  -- sla_tier: dependent list, parent_list_key = contract_type. A few tiers
  -- per contract type. `value` must be unique per LIST (not per parent
  -- group), so each item's slug is prefixed with its parent type.
  insert into public.reference_lists (organization_id, list_key, name, parent_list_key)
  values (p_organization_id, 'sla_tier', 'SLA Tier', 'contract_type')
  on conflict (organization_id, list_key) do nothing;

  select id into v_sla_tier_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'sla_tier';

  select id into v_maintenance_id from public.reference_list_items where reference_list_id = v_contract_type_list_id and value = 'maintenance';
  select id into v_service_id from public.reference_list_items where reference_list_id = v_contract_type_list_id and value = 'service';
  select id into v_installation_id from public.reference_list_items where reference_list_id = v_contract_type_list_id and value = 'installation';
  select id into v_warranty_id from public.reference_list_items where reference_list_id = v_contract_type_list_id and value = 'warranty';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, parent_item_id)
  values
    (v_sla_tier_list_id, p_organization_id, 'maintenance_standard', 'Standard', 1, v_maintenance_id),
    (v_sla_tier_list_id, p_organization_id, 'maintenance_priority', 'Priority', 2, v_maintenance_id),
    (v_sla_tier_list_id, p_organization_id, 'maintenance_premium', 'Premium', 3, v_maintenance_id),
    (v_sla_tier_list_id, p_organization_id, 'service_standard', 'Standard', 4, v_service_id),
    (v_sla_tier_list_id, p_organization_id, 'service_express', 'Express', 5, v_service_id),
    (v_sla_tier_list_id, p_organization_id, 'installation_standard', 'Standard', 6, v_installation_id),
    (v_sla_tier_list_id, p_organization_id, 'installation_expedited', 'Expedited', 7, v_installation_id),
    (v_sla_tier_list_id, p_organization_id, 'warranty_standard', 'Standard', 8, v_warranty_id),
    (v_sla_tier_list_id, p_organization_id, 'warranty_extended', 'Extended', 9, v_warranty_id)
  on conflict (reference_list_id, value) do nothing;

  -- billing_terms: for contracts.billing_terms_id. Flat, standalone list.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'billing_terms', 'Billing Terms')
  on conflict (organization_id, list_key) do nothing;

  select id into v_billing_terms_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'billing_terms';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_billing_terms_list_id, p_organization_id, 'monthly', 'Monthly', 1, true),
    (v_billing_terms_list_id, p_organization_id, 'quarterly', 'Quarterly', 2, false),
    (v_billing_terms_list_id, p_organization_id, 'annually', 'Annually', 3, false),
    (v_billing_terms_list_id, p_organization_id, 'per_visit', 'Per-visit', 4, false),
    (v_billing_terms_list_id, p_organization_id, 'one_time', 'One-time', 5, false)
  on conflict (reference_list_id, value) do nothing;

  -- time_entry_type: for time_entries.entry_type_id. Flat list.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'time_entry_type', 'Time Entry Type')
  on conflict (organization_id, list_key) do nothing;

  select id into v_time_entry_type_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'time_entry_type';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_time_entry_type_list_id, p_organization_id, 'labor', 'Labor', 1, true),
    (v_time_entry_type_list_id, p_organization_id, 'travel', 'Travel', 2, false),
    (v_time_entry_type_list_id, p_organization_id, 'break', 'Break', 3, false)
  on conflict (reference_list_id, value) do nothing;

  -- quote_status: for quotes.status_id (issue #16). Flat list, ordered
  -- lifecycle: Draft (default) -> Sent -> Accepted / Rejected / Expired.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'quote_status', 'Quote Status')
  on conflict (organization_id, list_key) do nothing;

  select id into v_quote_status_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'quote_status';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_quote_status_list_id, p_organization_id, 'draft', 'Draft', 1, true),
    (v_quote_status_list_id, p_organization_id, 'sent', 'Sent', 2, false),
    (v_quote_status_list_id, p_organization_id, 'accepted', 'Accepted', 3, false),
    (v_quote_status_list_id, p_organization_id, 'rejected', 'Rejected', 4, false),
    (v_quote_status_list_id, p_organization_id, 'expired', 'Expired', 5, false)
  on conflict (reference_list_id, value) do nothing;
end;
$$;

comment on function public.seed_default_reference_lists(uuid) is
  'Idempotent (on conflict do nothing throughout). Called automatically by organizations_seed_reference_lists on every new organization, and once directly in each feature migration to backfill organizations that already existed. Extended in 20260824090000_quotes_core.sql with the quote_status (flat, ordered lifecycle) block. Future picklists should extend this function the same way, plus a one-time backfill call in that feature''s own migration.';

-- Backfill: seed the new quote_status list (and any missing items from
-- earlier blocks) for every organization that already existed before this
-- migration ran — the organizations_seed_reference_lists trigger only fires
-- for future inserts.
do $$
declare
  r record;
begin
  for r in select id from public.organizations loop
    perform public.seed_default_reference_lists(r.id);
  end loop;
end;
$$;
