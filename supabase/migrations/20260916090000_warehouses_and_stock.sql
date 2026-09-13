-- Per-engineer warehouse/stock module, schema (issue #181, "[Story] Locaties
-- voorraad beheren" — first of a three-story sequence: #181 this migration,
-- #182 stock deduction from work orders, #180 not yet scoped). Confirmed with
-- the product owner: engineer-only warehouses for now (no general/central
-- warehouse, no manual multi-warehouse creation UI) — exactly one warehouse
-- per (organization, engineer), auto-created, never deleted.
--
-- Two new tables:
--
-- 1. `warehouses` — one per (organization_id, engineer user_id). Auto-created
--    by a trigger on `memberships` (see design note 2 below), never created
--    through a client-facing "new warehouse" flow. Has an editable `name`
--    (default: the engineer's own name/email, same "sensible default,
--    overridable" shape `assets.name`'s auto-generated Asset ID established
--    for a caller-optional NOT NULL text column).
--
-- 2. `warehouse_stock` — join of `warehouse_id` + `article_id` (from the
--    EXISTING `articles` catalog, not a copy), one row per article actually
--    added to that warehouse (never auto-seeded with the whole catalog — a
--    tenant adds articles to a warehouse one at a time via a search/add
--    flow, `api-backend-engineer`'s follow-up). `quantity` (on-hand,
--    editable), `min_threshold` (editable, drives a red/orange/green status
--    color at the application layer — no auto-reorder logic, explicitly out
--    of scope), `total_consumed` (read-only cumulative counter, written only
--    by a future system/trigger path — issue #182), `last_counted_at`
--    (nullable timestamp — see design note 3). No stock VALUE column at all:
--    purchase/sale value is `quantity * articles.purchase_price` /
--    `quantity * articles.sale_price`, always computed live at read time —
--    the exact "never snapshot, always read live" philosophy this schema
--    already applies to `work_order_articles`/`quote_line_items` pricing
--    (`20260830100000_work_order_articles_and_quote_traceability.sql`'s own
--    design note 2).
--
-- Design notes (read before extending):
--
-- 1. **Auto-creation is a DB trigger on `memberships`, not application code.**
--    A membership row is created in exactly two places today —
--    `redeem_invite()` (`20260822180000_invites.sql`) and
--    `updateTeamMemberRole` (`lib/team/actions.ts`, a plain RLS-scoped
--    UPDATE) — and a third could appear later. Putting "create a warehouse"
--    in either call site would be missed by the other, and by any future
--    membership-mutating path. Two triggers on `memberships` instead:
--    `memberships_ensure_engineer_warehouse_insert` (`AFTER INSERT`, `WHEN
--    (new.role = 'engineer')`) and `memberships_ensure_engineer_warehouse_
--    update` (`AFTER UPDATE OF role`, `WHEN (new.role = 'engineer' and
--    old.role is distinct from 'engineer')` — `role` is `NOT NULL`, so this
--    reduces to "the role just became engineer", covering promotion).
--    Idempotent (`ON CONFLICT (organization_id, user_id) DO NOTHING`) so a
--    role flipping away from engineer and back doesn't create a duplicate.
--    Demoting away from engineer deliberately does NOT delete/deactivate the
--    warehouse (no AC for that) — hiding it from engineer-scoped UI once the
--    role changes is a frontend/query concern, not a schema one. Both
--    triggers call the same `ensure_engineer_warehouse()` function, which is
--    `SECURITY DEFINER` so it can write `warehouses` regardless of which
--    role (an invitee via `redeem_invite`, or an owner via
--    `updateTeamMemberRole`) actually performed the membership write.
--
-- 2. **`warehouses.name` default**: filled by `derive_warehouse_default_name`
--    (`BEFORE INSERT`, fires whenever `name` is omitted/blank) from
--    `users.full_name`, falling back to `users.email` when no full name is
--    set yet — same "fill in a sensible default, but the column stays
--    genuinely editable afterward" shape as `articles`' `derive_article_
--    defaults` and `assets`' auto-generated Asset ID. This is the ONE trigger
--    both the auto-creation path (`ensure_engineer_warehouse` inserts with no
--    explicit `name`) and a hypothetical manual owner-insert share, so the
--    default logic lives in exactly one place.
--
-- 3. **`last_counted_at` — no dedicated stock-take workflow.** Confirmed with
--    the product owner: this column is stamped to `now()` whenever a HUMAN
--    manually edits the on-hand `quantity` (a planner/owner/administratie
--    correcting the count), and must NOT be touched when `quantity` changes
--    via automatic consumption deduction (issue #182's future work-order
--    hook). Both write paths update the same `quantity` column, so the split
--    is enforced by which columns a given UPDATE statement's own column list
--    touches, not by inferring "was this manual" inside a trigger — this is
--    deliberately an `api-backend-engineer` concern (two distinct Server
--    Actions / one future SECURITY DEFINER trigger, each naming its own
--    explicit column list), not something this schema can or should decide
--    on its own. `total_consumed` is symmetric: read-only from every
--    client-facing grant today (excluded from both INSERT and UPDATE column
--    grants below) — issue #182 is expected to add a `SECURITY DEFINER`
--    trigger on `work_order_articles` (mirroring `work_order_auto_draft_
--    quotes.sql`'s "system trigger bypasses RLS/grants" mechanism) that
--    increments it and decrements `quantity` together, scoped to the work
--    order's assigned engineer's own warehouse. NOT built here — this
--    migration must not touch `work_order_articles` at all.
--
-- 4. **`organization_id` denormalization + `user_id` denormalization on
--    `warehouse_stock`.** `organization_id` is denormalized from
--    `warehouse_id` (`derive_warehouse_stock_organization_id`, the same
--    `article_components`/`work_order_articles` BEFORE INSERT/UPDATE OF
--    <parent-fk> pattern). `user_id` (the warehouse's own engineer) is ALSO
--    denormalized onto `warehouse_stock` by that same trigger, for the exact
--    reason `activity_notes`/`activity_events` denormalize `action_holder_id`
--    from their parent `activities` row
--    (`20260902090000_activity_notes_and_events.sql`): it lets the engineer
--    "read own" RLS branch stay a flat `user_id = auth.uid()` column check,
--    with no in-policy join through `warehouses`. `article_id` must belong to
--    the SAME organization as the warehouse (`validate_warehouse_stock_
--    relations`, the same org-match "_relations"-style check `validate_work_
--    order_article_relations` does for `articles`, since `articles` is a
--    dedicated domain table, not a `reference_list_items` row).
--
-- 5. **RBAC matrix (confirmed with the product owner after this migration's
--    first draft flagged the question below; RLS shape implements it
--    verbatim — `auth-rbac-engineer` still owns wiring
--    `packages/rbac/src/permissions.ts` / `lib/rbac/features.ts` / nav on top
--    of this):**
--      Owner:          CRUD (all rows)
--      Planner:        CRUD (all rows) — they operationally manage engineer
--                       stock assignments day to day, including the
--                       search/add-article and remove-article flows.
--      Administratie:  CRUD (all rows) — consistent with their existing CRUD
--                       role on the `articles` table itself (stock lines
--                       reference articles they already fully manage).
--      Engineer:       Read own only (their own warehouse/stock rows;
--                       real quantity writes from the engineer side are a
--                       PWA/system flow, issue #182, not a raw table grant)
--      Finance:        Read (all rows — stock value visibility)
--    (First draft of this migration proposed Planner/Administratie as
--    Read/Update-only, no Create/Delete, which would have made "add a new
--    article to a warehouse" / "remove one" Owner-only — flagged for
--    confirmation rather than guessed silently. Product owner confirmed the
--    wider CRUD shape above; the RLS policies below implement it.)
--    `warehouses` itself (the name-only editable field) uses the identical
--    role split for consistency (Owner/Planner/Administratie CRUD; Engineer
--    read own; Finance read).
--
-- Column-grant lockdown: both new tables, so the usual "this project's public
-- schema grants ALL to authenticated/anon by default on new tables" gotcha
-- applies — `revoke all` before the explicit grants, `id` included in each
-- INSERT grant (learned the hard way in `20260829110000_articles_id_insert_
-- grants.sql`; `work_order_articles`'s own migration already got this right).

-- ---------------------------------------------------------------------------
-- 1. warehouses: one per (organization_id, engineer user_id).
-- ---------------------------------------------------------------------------
create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

comment on table public.warehouses is
  'One per-engineer warehouse ("magazijn") per (organization_id, user_id) — issue #181. Auto-created (idempotent) by ensure_engineer_warehouse whenever a memberships row''s role becomes/is ''engineer'' (see the two triggers on public.memberships below); no client-facing "create a warehouse" flow exists today (product-owner-confirmed: engineer-only, no general/central warehouse, no manual multi-warehouse UI). Demoting a member away from engineer does NOT delete/deactivate their warehouse.';
comment on column public.warehouses.user_id is
  'The engineer this warehouse belongs to. NOT validated against memberships.role at the DB layer beyond the auto-creation trigger itself — a manual owner-insert (RLS permits it, matching the "Owner CRUD" matrix cell) is trusted the same way other owner-only manual overrides in this schema are.';
comment on column public.warehouses.name is
  'Editable warehouse name. Defaults (derive_warehouse_default_name, BEFORE INSERT, fires when omitted/blank) to the engineer''s users.full_name, falling back to users.email when no full name is set — the same "sensible default, still genuinely editable" shape articles/assets already use for a caller-optional NOT NULL text column.';

create index warehouses_organization_id_idx on public.warehouses (organization_id);
create index warehouses_user_id_idx on public.warehouses (user_id);
create index warehouses_created_by_idx on public.warehouses (created_by);

alter table public.warehouses enable row level security;
alter table public.warehouses force row level security;

-- Fills `name` with the engineer's own full_name/email when omitted or
-- blank. Runs before articles-style defaulting patterns; no separate
-- validation trigger is needed since name has no cross-table constraint.
create or replace function public.derive_warehouse_default_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text;
  v_email text;
begin
  if new.name is null or btrim(new.name) = '' then
    select full_name, email into v_full_name, v_email
    from public.users
    where id = new.user_id;

    new.name := coalesce(nullif(btrim(v_full_name), ''), v_email, 'Warehouse');
  end if;

  return new;
end;
$$;

comment on function public.derive_warehouse_default_name() is
  'BEFORE INSERT trigger on public.warehouses: fills name from users.full_name (falling back to users.email, then the literal ''Warehouse'') when the caller omits it or supplies a blank string. Shared by both ensure_engineer_warehouse''s auto-creation insert and any manual owner-insert.';

create trigger warehouses_derive_default_name
  before insert on public.warehouses
  for each row execute function public.derive_warehouse_default_name();

create trigger warehouses_set_created_by
  before insert on public.warehouses
  for each row execute function public.set_created_by();

create trigger warehouses_set_updated_at
  before update on public.warehouses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: warehouses — see design note 5 above.
--   owner / planner / administratie: CRUD, all rows
--   engineer:                        SELECT own row only (user_id =
--                                     auth.uid()); no write at all
--   finance:                         SELECT, all rows
-- ---------------------------------------------------------------------------
create policy "warehouses_select_scoped"
on public.warehouses
for select
to authenticated
using (
  public.is_member_of_org(organization_id)
  and (
    public.current_member_role(organization_id) <> 'engineer'
    or user_id = auth.uid()
  )
);

create policy "warehouses_insert_owner_or_planner_or_administratie"
on public.warehouses
for insert
to authenticated
with check (
  public.current_member_role(organization_id) in ('owner', 'planner', 'administratie')
);

create policy "warehouses_update_owner_or_planner_or_administratie"
on public.warehouses
for update
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'planner', 'administratie')
)
with check (
  public.current_member_role(organization_id) in ('owner', 'planner', 'administratie')
);

create policy "warehouses_delete_owner_or_planner_or_administratie"
on public.warehouses
for delete
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'planner', 'administratie')
);

-- New table: this project's public schema grants ALL privileges to
-- authenticated/anon by default on every newly created table — always
-- revoke first (see 20260822193000_fix_clients_sites_assets_column_grants.sql).
revoke all on public.warehouses from authenticated;

grant select, delete on public.warehouses to authenticated;
-- created_by intentionally excluded: stamped by set_created_by. `id` IS
-- included (this migration's own RLS test assigns deterministic fixture ids).
grant insert (
  id, organization_id, user_id, name
) on public.warehouses to authenticated;
-- organization_id/user_id are insert-only (immutable after creation) — only
-- name is meaningfully editable in place.
grant update (
  name
) on public.warehouses to authenticated;

-- ---------------------------------------------------------------------------
-- ensure_engineer_warehouse: idempotent auto-creation, fired from two
-- triggers on public.memberships (see design note 1 above). SECURITY DEFINER
-- so it works regardless of which role performed the membership write
-- (redeem_invite's invitee, or an owner via updateTeamMemberRole).
-- ---------------------------------------------------------------------------
create or replace function public.ensure_engineer_warehouse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.warehouses (organization_id, user_id)
  values (new.organization_id, new.user_id)
  on conflict (organization_id, user_id) do nothing;

  return new;
end;
$$;

comment on function public.ensure_engineer_warehouse() is
  'AFTER INSERT / AFTER UPDATE OF role trigger function on public.memberships: idempotently creates that member''s warehouse the moment their role is (or becomes) ''engineer''. Never deletes/deactivates a warehouse on demotion (no AC for that). See design note 1 in 20260916090000_warehouses_and_stock.sql.';

create trigger memberships_ensure_engineer_warehouse_insert
  after insert on public.memberships
  for each row
  when (new.role = 'engineer')
  execute function public.ensure_engineer_warehouse();

create trigger memberships_ensure_engineer_warehouse_update
  after update of role on public.memberships
  for each row
  when (new.role = 'engineer' and old.role is distinct from 'engineer'::public.membership_role)
  execute function public.ensure_engineer_warehouse();

-- Backfill: create warehouses for every engineer membership that already
-- existed before this migration ran (the two triggers above only fire for
-- future inserts/updates).
insert into public.warehouses (organization_id, user_id)
select m.organization_id, m.user_id
from public.memberships m
where m.role = 'engineer'
on conflict (organization_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. warehouse_stock: join of warehouse_id + article_id, one row per article
--    actually added to that warehouse. organization_id/user_id denormalized
--    from warehouse_id (design note 4 above).
-- ---------------------------------------------------------------------------
create table public.warehouse_stock (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  article_id uuid not null references public.articles (id),
  user_id uuid not null references public.users (id) on delete cascade,
  quantity numeric(12, 3) not null default 0,
  min_threshold numeric(12, 3),
  total_consumed numeric(12, 3) not null default 0,
  last_counted_at timestamptz,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (warehouse_id, article_id),
  constraint warehouse_stock_quantity_non_negative check (quantity >= 0),
  constraint warehouse_stock_min_threshold_non_negative check (min_threshold is null or min_threshold >= 0),
  constraint warehouse_stock_total_consumed_non_negative check (total_consumed >= 0)
);

comment on table public.warehouse_stock is
  'Per-warehouse stock line for one article (issue #181) — a warehouse is NOT auto-seeded with the whole articles catalog; a tenant adds articles one at a time via a search/add flow. No stock VALUE column: purchase/sale value is always quantity * articles.purchase_price/sale_price, computed live at read time, never snapshotted here (same philosophy as work_order_articles/quote_line_items pricing).';
comment on column public.warehouse_stock.organization_id is
  'Denormalized from warehouse_id (via derive_warehouse_stock_organization_id). Never client-writable.';
comment on column public.warehouse_stock.user_id is
  'Denormalized from warehouses.user_id (the warehouse''s own engineer), via derive_warehouse_stock_organization_id — same "denormalize the owning actor so RLS stays a flat column check" reasoning as activity_notes/activity_events'' own action_holder_id copy. Never client-writable.';
comment on column public.warehouse_stock.article_id is
  'The catalog article stocked in this warehouse. Must belong to the same organization_id as the warehouse (validate_warehouse_stock_relations). Insert-only (immutable) — delete and re-insert to change which article a line represents.';
comment on column public.warehouse_stock.quantity is
  'Current on-hand quantity. numeric(12,3), matching article_components/work_order_articles'' precision (the article_unit reference list includes Liter/Kg, so a fractional on-hand quantity is real). Editable via TWO distinct write paths that must stay decoupled at the application layer: a human manually correcting the count (which ALSO sets last_counted_at = now() in the same statement) and a future automatic consumption deduction (issue #182, which must NOT touch last_counted_at) — see design note 3 in 20260916090000_warehouses_and_stock.sql. This schema does not and cannot infer which path a given UPDATE is; that split is enforced by each write path''s own explicit column list.';
comment on column public.warehouse_stock.min_threshold is
  'Optional minimum/threshold quantity, used by the application layer to color this line red/orange/green. No auto-reorder logic (explicitly out of scope).';
comment on column public.warehouse_stock.total_consumed is
  'Read-only cumulative consumed quantity. Excluded from every client-facing INSERT/UPDATE column grant — only a future SECURITY DEFINER trigger (issue #182, hooking work_order_articles inserts) is expected to write it, alongside decrementing quantity in the same operation.';
comment on column public.warehouse_stock.last_counted_at is
  'Nullable timestamp, stamped to now() ONLY by a human manually editing quantity (a planner/owner/administratie correction) — never touched by the future automatic consumption-deduction path. See design note 3.';

create index warehouse_stock_organization_id_idx on public.warehouse_stock (organization_id);
create index warehouse_stock_article_id_idx on public.warehouse_stock (article_id);
create index warehouse_stock_user_id_idx on public.warehouse_stock (user_id);
create index warehouse_stock_created_by_idx on public.warehouse_stock (created_by);

alter table public.warehouse_stock enable row level security;
alter table public.warehouse_stock force row level security;

-- Derives organization_id AND user_id from warehouse_id (blocking
-- cross-organization re-parenting), mirroring derive_work_order_article_
-- organization_id / derive_article_component_organization_id, extended with
-- the extra denormalized user_id column (design note 4).
create or replace function public.derive_warehouse_stock_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_user_id uuid;
begin
  select w.organization_id, w.user_id into v_org_id, v_user_id
  from public.warehouses w
  where w.id = new.warehouse_id;

  if v_org_id is null then
    raise exception 'warehouse_stock.warehouse_id % does not reference an existing warehouse', new.warehouse_id
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from v_org_id then
    raise exception 'Cannot move a warehouse stock row to a warehouse in a different organization'
      using errcode = '23514';
  end if;

  new.organization_id := v_org_id;
  new.user_id := v_user_id;
  return new;
end;
$$;

comment on function public.derive_warehouse_stock_organization_id() is
  'BEFORE INSERT/UPDATE OF warehouse_id trigger on public.warehouse_stock: sets organization_id and user_id from the referenced warehouse, and blocks cross-organization re-parenting. Mirrors derive_work_order_article_organization_id, extended with the extra user_id denormalization (design note 4, 20260916090000_warehouses_and_stock.sql).';

create trigger warehouse_stock_derive_organization_id
  before insert or update of warehouse_id on public.warehouse_stock
  for each row execute function public.derive_warehouse_stock_organization_id();

-- Cross-field consistency: article_id must belong to the same organization as
-- this row's own (already-derived) organization_id.
create or replace function public.validate_warehouse_stock_relations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_article_org uuid;
begin
  select organization_id into v_article_org
  from public.articles
  where id = new.article_id;

  if v_article_org is null then
    raise exception 'warehouse_stock.article_id % does not reference an existing article', new.article_id
      using errcode = '23503';
  elsif v_article_org <> new.organization_id then
    raise exception 'warehouse_stock.article_id must belong to the same organization as the warehouse'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.validate_warehouse_stock_relations() is
  'BEFORE INSERT/UPDATE OF warehouse_id, article_id trigger on public.warehouse_stock: rejects an article_id from a different organization than this row''s own (derived) organization_id. Runs after warehouse_stock_derive_organization_id (alphabetically later trigger name, same timing), so new.organization_id is already final.';

create trigger warehouse_stock_validate_relations
  before insert or update of warehouse_id, article_id on public.warehouse_stock
  for each row execute function public.validate_warehouse_stock_relations();

create trigger warehouse_stock_set_created_by
  before insert on public.warehouse_stock
  for each row execute function public.set_created_by();

create trigger warehouse_stock_set_updated_at
  before update on public.warehouse_stock
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: warehouse_stock — see design note 5 above.
--   owner / planner / administratie: CRUD, all rows (add/remove a stocked
--                                    article, or adjust an existing line)
--   engineer:                        SELECT own warehouse's rows only
--                                    (user_id = auth.uid()); no write at all
--   finance:                         SELECT, all rows
-- ---------------------------------------------------------------------------
create policy "warehouse_stock_select_scoped"
on public.warehouse_stock
for select
to authenticated
using (
  public.is_member_of_org(organization_id)
  and (
    public.current_member_role(organization_id) <> 'engineer'
    or user_id = auth.uid()
  )
);

create policy "warehouse_stock_insert_owner_or_planner_or_administratie"
on public.warehouse_stock
for insert
to authenticated
with check (
  public.current_member_role(organization_id) in ('owner', 'planner', 'administratie')
);

create policy "warehouse_stock_update_owner_or_planner_or_administratie"
on public.warehouse_stock
for update
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'planner', 'administratie')
)
with check (
  public.current_member_role(organization_id) in ('owner', 'planner', 'administratie')
);

create policy "warehouse_stock_delete_owner_or_planner_or_administratie"
on public.warehouse_stock
for delete
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'planner', 'administratie')
);

-- New table: this project's public schema grants ALL privileges to
-- authenticated/anon by default on every newly created table — always
-- revoke first (see 20260822193000_fix_clients_sites_assets_column_grants.sql).
revoke all on public.warehouse_stock from authenticated;

grant select, delete on public.warehouse_stock to authenticated;
-- organization_id/user_id intentionally excluded: derived by
-- derive_warehouse_stock_organization_id. created_by intentionally excluded:
-- stamped by set_created_by. total_consumed intentionally excluded from BOTH
-- insert and update: read-only from every client-facing path today (design
-- note 3) — only a future issue #182 SECURITY DEFINER trigger writes it.
-- `id` IS included (this migration's own RLS test assigns deterministic
-- fixture ids).
grant insert (
  id, warehouse_id, article_id, quantity, min_threshold, last_counted_at
) on public.warehouse_stock to authenticated;
-- warehouse_id/article_id are insert-only (immutable after creation, like
-- work_order_articles.work_order_id) — delete + re-insert to move a stock
-- line to a different warehouse/article. quantity/min_threshold/
-- last_counted_at are the meaningfully-editable-in-place columns; the two
-- write paths described in design note 3 (manual count vs. future automatic
-- deduction) are distinguished by which of these a given UPDATE's own
-- column list actually touches, not by any DB-level mechanism.
grant update (
  quantity, min_threshold, last_counted_at
) on public.warehouse_stock to authenticated;
