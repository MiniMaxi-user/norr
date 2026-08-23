-- Checklists / inspection forms on Work Orders (issue #14, Phase 2 —
-- "Operations core"). See docs/ARCHITECTURE.md ("Core schema (v1)") and
-- docs/ROADMAP.md.
--
-- Two halves, two different EXISTING patterns reused wholesale (no new
-- pattern invented):
--   1. `checklist_templates` / `checklist_template_items` — tenant-configured
--      CONTAINER data, same shape/RLS boundary as `reference_lists` /
--      `reference_list_items` (20260822200000_reference_lists.sql): owner
--      configures, any member reads. A template is not itself modeled as a
--      reference list (its items carry columns a picklist item doesn't need
--      — `is_required`, `sort_order` as first-class ordering, no `value`
--      slug, no dependent-list semantics, no per-org multiplicity beyond
--      "however many templates this org has configured"), so it's its own
--      table pair, but the RLS/grant-lockdown shape is copied exactly.
--   2. `work_order_checklists` / `work_order_checklist_items` — a Work Order
--      SUB-RESOURCE, same spirit as `time_entries`
--      (20260823180000_time_entries_core.sql): denormalizes
--      `organization_id` from the parent work order so RLS stays a
--      single-column check. RLS mirrors `work_orders`' OWN per-role shape
--      exactly here (not `time_entries`' — engineer gets NO create/delete on
--      either instance table, matching Work Orders' own create boundary,
--      not Time Entries' `create_own` carve-out).
--
-- Explicitly OUT OF SCOPE for this pass (a deliberate, documented follow-up,
-- not an oversight): photo attachments and e-signature capture. Both need
-- Supabase Storage integration (buckets, signed upload URLs, storage RLS
-- policies) — its own, larger piece of work. This migration builds the
-- checkbox/notes completion mechanics only. When that follow-up lands, it
-- most likely adds a `work_order_checklist_item_photos` (or similar) child
-- table plus a `signed_off_by`/`signed_off_at`/`signature_url` trio on
-- `work_order_checklists`, not a redesign of what's here.
--
-- Design notes (read before extending):
--
-- 1. Template-to-instance copy mechanism: inserting a `work_order_checklists`
--    row with a non-null `checklist_template_id` fires an AFTER INSERT
--    trigger (`work_order_checklists_instantiate_items`, `WHEN
--    (new.checklist_template_id is not null)`) that calls
--    `copy_checklist_template_items_to_work_order_checklist(work_order_checklist_id)`
--    (SECURITY DEFINER), which snapshots every current
--    `checklist_template_items` row for that template into
--    `work_order_checklist_items` — copying `label`/`is_required`/
--    `sort_order` as plain values, not a live join, so a later edit to the
--    template does NOT retroactively rewrite an already-in-progress
--    instance. Chosen as a TRIGGER (not a callable RPC the API layer must
--    remember to invoke separately) so a single `insert into
--    work_order_checklists` always yields a fully-populated checklist in the
--    same round trip — matches this schema's existing trigger-heavy
--    derivation style (`derive_work_order_organization_id` et al.) rather
--    than adding a new "caller must remember to also call X" convention
--    that's one missed call away from a silently-empty checklist.
--
-- 2. `assigned_to` denormalization + sync DECISION: both
--    `work_order_checklists` and `work_order_checklist_items` denormalize
--    `assigned_to` from the parent work order (not just `organization_id`)
--    so their RLS stays a simple column check
--    (`current_member_role(...) in (...) or assigned_to = auth.uid()`)
--    instead of a join/subquery into `work_orders` on every row check.
--    DECISION: kept in sync ACTIVELY via an `after update of assigned_to on
--    work_orders` trigger (`work_orders_sync_checklist_assigned_to` ->
--    `sync_work_order_checklist_assigned_to()`, SECURITY DEFINER) — drift is
--    NOT accepted here. Reasoning: unlike a purely cosmetic denormalized
--    label, `assigned_to` here directly backs an access-control boundary —
--    a stale value would either wrongly deny the newly-assigned engineer or
--    wrongly retain access for the previous one after a reassignment, which
--    is a real correctness/security bug in the tenant/row isolation
--    boundary, not just a display inconvenience. The cost is two extra
--    single-row UPDATEs on the (uncommon) event of reassigning a work order
--    that already has a checklist attached — negligible.
--
-- 3. `work_order_checklists` is close to fully immutable after creation by
--    design: `work_order_id` and `checklist_template_id` are BOTH excluded
--    from its UPDATE column grant (no legitimate "move this checklist to a
--    different work order" action, and re-templating after items are
--    already snapshotted would either silently do nothing to existing items
--    or need a real reconciliation flow this pass doesn't build) — correct
--    a wrong template choice by DELETE + re-INSERT instead, the same "no
--    UPDATE, delete+re-insert to change a link" precedent `contract_assets`
--    already established (20260823150000_contracts_core.sql). Net effect:
--    an UPDATE RLS policy still exists on this table (matching `work_orders`'
--    own per-role shape exactly, and ready the moment a future column, e.g.
--    the photo/signature follow-up above, needs it), but TODAY no column is
--    grant-exposed for it, so a functional UPDATE is unreachable for every
--    role alike — intentional parity/future-proofing, not a bug. The real,
--    functional "engineer can update" surface for this module is entirely on
--    `work_order_checklist_items` (checking boxes, editing per-instance
--    label/notes) — see below.
--
-- 4. `work_order_checklist_items` are a real, editable per-instance snapshot,
--    not a read-only copy: `label`/`is_required`/`sort_order` are plain
--    client-writable columns (an owner/planner can correct an item's text or
--    reorder it for this one instance without touching the shared template),
--    and `notes`/`is_checked` are the actual completion state an engineer
--    fills in. `template_item_id` is excluded from BOTH the INSERT and
--    UPDATE grants — it's purely an internal/historical breadcrumb,
--    populated only by the SECURITY DEFINER copy function (which bypasses
--    column grants entirely, being SECURITY DEFINER), never client-set
--    directly. This also means a planner/owner CAN insert a bespoke ad-hoc
--    item with no `template_item_id` at all (e.g. adding a one-off item
--    beyond what the template had, or building an instance up from scratch
--    on a checklist created with `checklist_template_id = null`).
--
-- 5. `checked_by`/`checked_at` are trigger-stamped
--    (`set_checklist_item_checked_fields`, mirrors `set_created_by`'s
--    "never client-suppliable" pattern), not client-writable: setting
--    `is_checked = true` stamps `checked_by = auth.uid()` /
--    `checked_at = now()`; setting it back to `false` clears both (an
--    unchecked item has no meaningful "who/when checked" value to keep).
--
-- Column-grant lockdown: four new tables, so the usual "this project's
-- public schema grants ALL to authenticated/anon by default on new tables"
-- gotcha applies to all four — `revoke all` before the explicit grants (see
-- the two `fix_*_column_grants` migrations). `id` IS included in every
-- INSERT grant below (not omitted), per the reasoning documented in
-- 20260823120000_work_orders_core.sql's grant-block comment: this
-- migration's own RLS test explicitly assigns deterministic fixture ids on
-- insert.

-- ---------------------------------------------------------------------------
-- checklist_templates: tenant-configured checklist container, same RLS/grant
-- shape as reference_lists (owner configures, any member reads).
-- ---------------------------------------------------------------------------
create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.checklist_templates is
  'Tenant-configured checklist/inspection-form template, attachable to any work order via work_order_checklists. Same RLS/grant shape as reference_lists: owner configures, any org member reads. See design notes in 20260823210000_checklists_core.sql.';

create index checklist_templates_organization_id_idx on public.checklist_templates (organization_id);
create index checklist_templates_created_by_idx on public.checklist_templates (created_by);

alter table public.checklist_templates enable row level security;
alter table public.checklist_templates force row level security;

create trigger checklist_templates_set_created_by
  before insert on public.checklist_templates
  for each row execute function public.set_created_by();

create trigger checklist_templates_set_updated_at
  before update on public.checklist_templates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- checklist_template_items: ordered items within a template. organization_id
-- is denormalized from checklist_template_id (see design note in
-- reference_list_items' derive_reference_list_item_org, mirrored here).
-- ---------------------------------------------------------------------------
create table public.checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  checklist_template_id uuid not null references public.checklist_templates (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  label text not null,
  is_required boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.checklist_template_items is
  'An ordered item within a checklist_templates template (e.g. "Check refrigerant level"). Snapshotted (copied by value, not live-joined) into work_order_checklist_items at instance-creation time, so later edits here do not retroactively rewrite an in-progress work order checklist.';
comment on column public.checklist_template_items.organization_id is
  'Denormalized from checklist_templates.organization_id (via checklist_template_id). Never client-writable — see derive_checklist_template_item_org trigger and the column-level grants below.';
comment on column public.checklist_template_items.is_required is
  'Copied (by value) into work_order_checklist_items.is_required at instance-creation time. Purely informational at this pass — no server-side enforcement that a required item must be checked before a work order can be completed; that''s an application-layer/UI concern to add later if wanted.';

create index checklist_template_items_checklist_template_id_idx on public.checklist_template_items (checklist_template_id);
create index checklist_template_items_organization_id_idx on public.checklist_template_items (organization_id);
create index checklist_template_items_created_by_idx on public.checklist_template_items (created_by);
create index checklist_template_items_template_sort_idx on public.checklist_template_items (checklist_template_id, sort_order);

alter table public.checklist_template_items enable row level security;
alter table public.checklist_template_items force row level security;

create or replace function public.derive_checklist_template_item_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select ct.organization_id into v_org_id
  from public.checklist_templates ct
  where ct.id = new.checklist_template_id;

  if v_org_id is null then
    raise exception 'checklist_template_items.checklist_template_id % does not reference an existing checklist template', new.checklist_template_id
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from v_org_id then
    raise exception 'Cannot move a checklist template item to a template in a different organization'
      using errcode = '23514';
  end if;

  new.organization_id := v_org_id;
  return new;
end;
$$;

comment on function public.derive_checklist_template_item_org() is
  'BEFORE INSERT/UPDATE OF checklist_template_id trigger: sets organization_id from the referenced template, and blocks cross-organization re-parenting. Same shape as derive_reference_list_item_org. checklist_template_id is excluded from the UPDATE column grant (see grants below), so the UPDATE branch here is a defense-in-depth backstop, matching that same precedent.';

create trigger checklist_template_items_derive_org
  before insert or update of checklist_template_id on public.checklist_template_items
  for each row execute function public.derive_checklist_template_item_org();

create trigger checklist_template_items_set_created_by
  before insert on public.checklist_template_items
  for each row execute function public.set_created_by();

create trigger checklist_template_items_set_updated_at
  before update on public.checklist_template_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS policies: checklist_templates / checklist_template_items
-- Read: any org member. Write: owner only. Identical shape to
-- reference_lists / reference_list_items.
-- ---------------------------------------------------------------------------
create policy "checklist_templates_select_member"
on public.checklist_templates
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "checklist_templates_insert_owner"
on public.checklist_templates
for insert
to authenticated
with check (public.is_org_owner(organization_id));

create policy "checklist_templates_update_owner"
on public.checklist_templates
for update
to authenticated
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

create policy "checklist_templates_delete_owner"
on public.checklist_templates
for delete
to authenticated
using (public.is_org_owner(organization_id));

revoke all on public.checklist_templates from authenticated;

grant select, delete on public.checklist_templates to authenticated;
grant insert (id, organization_id, name) on public.checklist_templates to authenticated;
grant update (name) on public.checklist_templates to authenticated;

create policy "checklist_template_items_select_member"
on public.checklist_template_items
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "checklist_template_items_insert_owner"
on public.checklist_template_items
for insert
to authenticated
with check (public.is_org_owner(organization_id));

create policy "checklist_template_items_update_owner"
on public.checklist_template_items
for update
to authenticated
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

create policy "checklist_template_items_delete_owner"
on public.checklist_template_items
for delete
to authenticated
using (public.is_org_owner(organization_id));

revoke all on public.checklist_template_items from authenticated;

grant select, delete on public.checklist_template_items to authenticated;
-- organization_id intentionally excluded: derived by
-- derive_checklist_template_item_org. checklist_template_id is accepted on
-- INSERT (you must say which template a new item belongs to) but excluded
-- from UPDATE (immutable after creation — same stance as
-- reference_list_items.reference_list_id).
grant insert (id, checklist_template_id, label, is_required, sort_order) on public.checklist_template_items to authenticated;
grant update (label, is_required, sort_order) on public.checklist_template_items to authenticated;

-- ---------------------------------------------------------------------------
-- work_order_checklists: at most one checklist instance per work order.
-- organization_id AND assigned_to are both denormalized from work_orders (see
-- design note 2 above for the assigned_to sync decision).
-- ---------------------------------------------------------------------------
create table public.work_order_checklists (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  checklist_template_id uuid references public.checklist_templates (id) on delete set null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  assigned_to uuid references public.users (id) on delete set null,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (work_order_id)
);

comment on table public.work_order_checklists is
  'At most one checklist instance per work order (unique work_order_id). organization_id and assigned_to are both denormalized from the parent work order (see design notes 2 and 3 in 20260823210000_checklists_core.sql) — assigned_to is actively kept in sync by a trigger on work_orders, not left to drift, because it backs this table''s (and work_order_checklist_items'') own RLS boundary. checklist_template_id is nullable (on delete set null) — the template could be deleted later without destroying the historical instance/items.';
comment on column public.work_order_checklists.checklist_template_id is
  'Which template was instantiated (nullable — a template could later be deleted, or a checklist could be built ad-hoc with no template at all). Copies its current items into work_order_checklist_items once, at INSERT time (see work_order_checklists_instantiate_items trigger) — NOT a live reference; editing the template afterwards does not affect an already-created instance. Excluded from the UPDATE grant (immutable after creation — see design note 3).';
comment on column public.work_order_checklists.assigned_to is
  'Denormalized from work_orders.assigned_to, kept in sync by work_orders_sync_checklist_assigned_to whenever the parent work order''s assigned_to changes. Never client-writable directly.';

create index work_order_checklists_checklist_template_id_idx on public.work_order_checklists (checklist_template_id);
create index work_order_checklists_organization_id_idx on public.work_order_checklists (organization_id);
create index work_order_checklists_assigned_to_idx on public.work_order_checklists (assigned_to);
create index work_order_checklists_created_by_idx on public.work_order_checklists (created_by);

alter table public.work_order_checklists enable row level security;
alter table public.work_order_checklists force row level security;

create or replace function public.derive_work_order_checklist_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_assigned_to uuid;
begin
  select wo.organization_id, wo.assigned_to into v_org_id, v_assigned_to
  from public.work_orders wo
  where wo.id = new.work_order_id;

  if v_org_id is null then
    raise exception 'work_order_checklists.work_order_id % does not reference an existing work order', new.work_order_id
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from v_org_id then
    raise exception 'Cannot move a work order checklist to a work order in a different organization'
      using errcode = '23514';
  end if;

  new.organization_id := v_org_id;
  new.assigned_to := v_assigned_to;

  return new;
end;
$$;

comment on function public.derive_work_order_checklist_fields() is
  'BEFORE INSERT/UPDATE OF work_order_id trigger on public.work_order_checklists: sets organization_id AND assigned_to from the referenced work order, and blocks cross-organization re-parenting. work_order_id is excluded from the UPDATE column grant (see design note 3), so the UPDATE branch here is a defense-in-depth backstop.';

create trigger work_order_checklists_derive_fields
  before insert or update of work_order_id on public.work_order_checklists
  for each row execute function public.derive_work_order_checklist_fields();

-- Snapshot-copy mechanism (design note 1): copies the chosen template's
-- current items into work_order_checklist_items, once, at instance-creation
-- time.
create or replace function public.copy_checklist_template_items_to_work_order_checklist(p_work_order_checklist_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template_id uuid;
begin
  select checklist_template_id into v_template_id
  from public.work_order_checklists
  where id = p_work_order_checklist_id;

  if v_template_id is null then
    return;
  end if;

  insert into public.work_order_checklist_items
    (work_order_checklist_id, template_item_id, label, is_required, sort_order)
  select p_work_order_checklist_id, cti.id, cti.label, cti.is_required, cti.sort_order
  from public.checklist_template_items cti
  where cti.checklist_template_id = v_template_id
  order by cti.sort_order;
end;
$$;

comment on function public.copy_checklist_template_items_to_work_order_checklist(uuid) is
  'SECURITY DEFINER: snapshots (copies by value) every current checklist_template_items row for the given work_order_checklists row''s checklist_template_id into work_order_checklist_items. No-op if checklist_template_id is null. Called by work_order_checklists_instantiate_items (AFTER INSERT), not intended to be called directly by client code (EXECUTE revoked from public below) — a plain INSERT into work_order_checklists is sufficient to get a fully-populated checklist.';

revoke all on function public.copy_checklist_template_items_to_work_order_checklist(uuid) from public;

create or replace function public.handle_work_order_checklist_instantiate_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.copy_checklist_template_items_to_work_order_checklist(new.id);
  return new;
end;
$$;

comment on function public.handle_work_order_checklist_instantiate_items() is
  'AFTER INSERT trigger on work_order_checklists (WHEN checklist_template_id is not null): triggers the one-time template-item snapshot copy. See design note 1 in 20260823210000_checklists_core.sql for why this is a trigger, not a second RPC the API layer must remember to call.';

create trigger work_order_checklists_instantiate_items
  after insert on public.work_order_checklists
  for each row
  when (new.checklist_template_id is not null)
  execute function public.handle_work_order_checklist_instantiate_items();

create trigger work_order_checklists_set_created_by
  before insert on public.work_order_checklists
  for each row execute function public.set_created_by();

-- ---------------------------------------------------------------------------
-- RLS policies: work_order_checklists — mirrors work_orders' own per-role
-- shape exactly (see design note 3 for why the UPDATE policy exists but has
-- no grant-exposed column today):
--   owner:    CRUD, all rows
--   planner:  CRUD, all rows
--   engineer: SELECT only, scoped to assigned_to = auth.uid(); no
--             INSERT/UPDATE(functional)/DELETE
--   finance/administratie: SELECT only, all rows
-- ---------------------------------------------------------------------------
create policy "work_order_checklists_select_scoped"
on public.work_order_checklists
for select
to authenticated
using (
  public.is_member_of_org(organization_id)
  and (
    public.current_member_role(organization_id) <> 'engineer'
    or assigned_to = auth.uid()
  )
);

create policy "work_order_checklists_insert_owner_or_planner"
on public.work_order_checklists
for insert
to authenticated
with check (
  public.current_member_role(organization_id) in ('owner', 'planner')
);

create policy "work_order_checklists_update_scoped"
on public.work_order_checklists
for update
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'planner')
  or (
    public.current_member_role(organization_id) = 'engineer'
    and assigned_to = auth.uid()
  )
)
with check (
  public.current_member_role(organization_id) in ('owner', 'planner')
  or (
    public.current_member_role(organization_id) = 'engineer'
    and assigned_to = auth.uid()
  )
);

create policy "work_order_checklists_delete_owner_or_planner"
on public.work_order_checklists
for delete
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'planner')
);

revoke all on public.work_order_checklists from authenticated;

grant select, delete on public.work_order_checklists to authenticated;
-- organization_id/assigned_to intentionally excluded: derived by
-- derive_work_order_checklist_fields. created_by excluded: stamped by
-- set_created_by. work_order_id/checklist_template_id are accepted on
-- INSERT only (immutable thereafter — see design note 3): no `grant update`
-- statement at all for this table today, since every remaining column is
-- either derived, stamped, or immutable-after-creation. The UPDATE RLS
-- policy above still exists (matches work_orders' shape, ready for a future
-- column) but is currently unreachable for every role alike — not a bug.
grant insert (id, work_order_id, checklist_template_id) on public.work_order_checklists to authenticated;

-- ---------------------------------------------------------------------------
-- work_order_checklist_items: the actual per-work-order checklist state,
-- snapshotted from the template at creation time. organization_id/
-- assigned_to are both denormalized from work_order_checklists (same
-- reasoning as that table's own denormalization from work_orders).
-- ---------------------------------------------------------------------------
create table public.work_order_checklist_items (
  id uuid primary key default gen_random_uuid(),
  work_order_checklist_id uuid not null references public.work_order_checklists (id) on delete cascade,
  template_item_id uuid references public.checklist_template_items (id) on delete set null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  assigned_to uuid references public.users (id) on delete set null,
  label text not null,
  is_required boolean not null default false,
  sort_order integer not null default 0,
  is_checked boolean not null default false,
  checked_by uuid references public.users (id) on delete set null,
  checked_at timestamptz,
  notes text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.work_order_checklist_items is
  'Per-work-order-checklist item state (the actual checkboxes an engineer fills in). label/is_required/sort_order are copied BY VALUE from checklist_template_items at instance-creation time (see copy_checklist_template_items_to_work_order_checklist) and remain independently editable per instance thereafter — not a live join to the template. template_item_id is historical-only (nullable, on delete set null, never client-writable).';
comment on column public.work_order_checklist_items.template_item_id is
  'Historical breadcrumb only — which checklist_template_items row this was originally copied from, if any (null for an ad-hoc item added directly to an instance). NOT authoritative for label/is_required/sort_order, which are this row''s own live values. Never client-writable (excluded from INSERT and UPDATE grants); populated only by copy_checklist_template_items_to_work_order_checklist (SECURITY DEFINER).';
comment on column public.work_order_checklist_items.is_checked is
  'Setting this true/false auto-stamps/clears checked_by/checked_at (set_checklist_item_checked_fields trigger) — those two columns are never client-writable directly.';
comment on column public.work_order_checklist_items.checked_by is
  'Auto-stamped to auth.uid() when is_checked is set true; cleared to null when is_checked is set back to false. Never client-writable — see set_checklist_item_checked_fields trigger and the column-level grants below.';

create index work_order_checklist_items_work_order_checklist_id_idx on public.work_order_checklist_items (work_order_checklist_id);
create index work_order_checklist_items_template_item_id_idx on public.work_order_checklist_items (template_item_id);
create index work_order_checklist_items_organization_id_idx on public.work_order_checklist_items (organization_id);
create index work_order_checklist_items_assigned_to_idx on public.work_order_checklist_items (assigned_to);
create index work_order_checklist_items_checked_by_idx on public.work_order_checklist_items (checked_by);
create index work_order_checklist_items_created_by_idx on public.work_order_checklist_items (created_by);
create index work_order_checklist_items_checklist_sort_idx on public.work_order_checklist_items (work_order_checklist_id, sort_order);

alter table public.work_order_checklist_items enable row level security;
alter table public.work_order_checklist_items force row level security;

create or replace function public.derive_work_order_checklist_item_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_assigned_to uuid;
begin
  select woc.organization_id, woc.assigned_to into v_org_id, v_assigned_to
  from public.work_order_checklists woc
  where woc.id = new.work_order_checklist_id;

  if v_org_id is null then
    raise exception 'work_order_checklist_items.work_order_checklist_id % does not reference an existing work order checklist', new.work_order_checklist_id
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from v_org_id then
    raise exception 'Cannot move a work order checklist item to a checklist in a different organization'
      using errcode = '23514';
  end if;

  new.organization_id := v_org_id;
  new.assigned_to := v_assigned_to;

  return new;
end;
$$;

comment on function public.derive_work_order_checklist_item_fields() is
  'BEFORE INSERT/UPDATE OF work_order_checklist_id trigger: sets organization_id AND assigned_to from the parent work_order_checklists row, and blocks cross-organization re-parenting. work_order_checklist_id is excluded from the UPDATE column grant (see grants below), so the UPDATE branch here is a defense-in-depth backstop.';

create trigger work_order_checklist_items_derive_fields
  before insert or update of work_order_checklist_id on public.work_order_checklist_items
  for each row execute function public.derive_work_order_checklist_item_fields();

create or replace function public.set_checklist_item_checked_fields()
returns trigger
language plpgsql
as $$
begin
  if new.is_checked then
    new.checked_by := auth.uid();
    new.checked_at := now();
  else
    new.checked_by := null;
    new.checked_at := null;
  end if;
  return new;
end;
$$;

comment on function public.set_checklist_item_checked_fields() is
  'BEFORE INSERT/UPDATE OF is_checked trigger: stamps checked_by = auth.uid() / checked_at = now() when is_checked becomes true, clears both when it becomes false. checked_by/checked_at are also excluded from every client-facing column grant (defense in depth — this trigger overwrites new.* unconditionally regardless of anything a caller could otherwise supply).';

create trigger work_order_checklist_items_set_checked_fields
  before insert or update of is_checked on public.work_order_checklist_items
  for each row execute function public.set_checklist_item_checked_fields();

create trigger work_order_checklist_items_set_created_by
  before insert on public.work_order_checklist_items
  for each row execute function public.set_created_by();

create trigger work_order_checklist_items_set_updated_at
  before update on public.work_order_checklist_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS policies: work_order_checklist_items — same shape as
-- work_order_checklists, EXCEPT engineer gets a real, functional UPDATE here
-- (this is where an engineer actually checks boxes / adds notes):
--   owner:    CRUD, all rows
--   planner:  CRUD, all rows
--   engineer: SELECT/UPDATE only, scoped to assigned_to = auth.uid(); no
--             INSERT, no DELETE
--   finance/administratie: SELECT only, all rows
-- ---------------------------------------------------------------------------
create policy "work_order_checklist_items_select_scoped"
on public.work_order_checklist_items
for select
to authenticated
using (
  public.is_member_of_org(organization_id)
  and (
    public.current_member_role(organization_id) <> 'engineer'
    or assigned_to = auth.uid()
  )
);

create policy "work_order_checklist_items_insert_owner_or_planner"
on public.work_order_checklist_items
for insert
to authenticated
with check (
  public.current_member_role(organization_id) in ('owner', 'planner')
);

create policy "work_order_checklist_items_update_scoped"
on public.work_order_checklist_items
for update
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'planner')
  or (
    public.current_member_role(organization_id) = 'engineer'
    and assigned_to = auth.uid()
  )
)
with check (
  public.current_member_role(organization_id) in ('owner', 'planner')
  or (
    public.current_member_role(organization_id) = 'engineer'
    and assigned_to = auth.uid()
  )
);

create policy "work_order_checklist_items_delete_owner_or_planner"
on public.work_order_checklist_items
for delete
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'planner')
);

revoke all on public.work_order_checklist_items from authenticated;

grant select, delete on public.work_order_checklist_items to authenticated;
-- organization_id/assigned_to excluded: derived by
-- derive_work_order_checklist_item_fields. created_by excluded: stamped by
-- set_created_by. checked_by/checked_at excluded: stamped by
-- set_checklist_item_checked_fields. template_item_id excluded from BOTH
-- insert and update (see design note 4 — internal/historical only, set only
-- by the SECURITY DEFINER copy function).
grant insert (
  id, work_order_checklist_id, label, is_required, sort_order, notes, is_checked
) on public.work_order_checklist_items to authenticated;
grant update (
  label, is_required, sort_order, notes, is_checked
) on public.work_order_checklist_items to authenticated;

-- ---------------------------------------------------------------------------
-- work_orders: new trigger keeping work_order_checklists/
-- work_order_checklist_items.assigned_to in sync with work_orders.assigned_to
-- (design note 2 above). Table already exists (20260823120000_work_orders_core.sql)
-- — this is an additive trigger only, not a table change.
-- ---------------------------------------------------------------------------
create or replace function public.sync_work_order_checklist_assigned_to()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checklist_id uuid;
begin
  update public.work_order_checklists
  set assigned_to = new.assigned_to
  where work_order_id = new.id
  returning id into v_checklist_id;

  if v_checklist_id is not null then
    update public.work_order_checklist_items
    set assigned_to = new.assigned_to
    where work_order_checklist_id = v_checklist_id;
  end if;

  return new;
end;
$$;

comment on function public.sync_work_order_checklist_assigned_to() is
  'AFTER UPDATE OF assigned_to trigger on public.work_orders: actively re-syncs the denormalized assigned_to on this work order''s work_order_checklists row (if any) and its work_order_checklist_items, rather than accepting drift — see design note 2 in 20260823210000_checklists_core.sql for why this denormalization must not be allowed to go stale (it backs those tables'' own RLS boundary, not just a display field). No-op if this work order has no checklist instance.';

create trigger work_orders_sync_checklist_assigned_to
  after update of assigned_to on public.work_orders
  for each row
  when (old.assigned_to is distinct from new.assigned_to)
  execute function public.sync_work_order_checklist_assigned_to();
