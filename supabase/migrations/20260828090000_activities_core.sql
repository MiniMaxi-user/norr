-- Activities ("meldingen") module: core entity (issue #59, "Als gebruiker
-- wil ik een melding kunnen aanmaken"). See docs/ARCHITECTURE.md ("Core
-- schema (v1)", RBAC matrix) and the issue's confirmed permission model
-- (mirrors Planning/Work Orders' shape, with a new create_own/update_own
-- twist — see design note 5 below).
--
-- A "melding"/activity is a new top-level entity that PRECEDES a Work Order:
-- a call-back request, a storing (fault) report, onderhoud (maintenance),
-- an afspraak (appointment), or an e-mail opvolging (follow-up), logged
-- against a client (and optionally an asset). Someone may later turn it
-- into a Work Order, but that conversion/link is explicitly OUT of scope for
-- this migration — `work_orders` is not touched at all here, same
-- "traceability is a later, separately-reviewed decision" stance
-- `quotes.source_quote_id`'s design took for its own conversion trail
-- (20260824090000_quotes_core.sql).
--
-- Design notes (read before extending):
--
-- 1. `organization_id` denormalization: same pattern as `sites`/`contacts`/
--    `work_orders`/`contracts`/`quotes` — denormalized from
--    `clients.organization_id` via `client_id` (`derive_activity_organization_id`,
--    including the cross-org re-parent guard), so RLS stays a single-column
--    `is_member_of_org(organization_id)`/`current_member_role(organization_id)`
--    shape with no in-policy joins. The same trigger fills in the
--    organization's default `activity_status` item when `status_id` is
--    omitted on insert (folded in for the usual trigger-ordering reason:
--    organization_id must be known first).
--
-- 2. `type_id` (not null, FK into reference_list_items' `activity_type`
--    list) has NO seeded default and NO auto-fill fallback, unlike
--    `status_id` — the 5-icon type picker on the new/edit page always
--    requires an explicit choice, so there is no sensible "silently defaults
--    to X" behavior here (an omitted type_id simply fails NOT NULL, same as
--    an omitted `description`). `activity_type` is seeded with 5 flat items
--    (stable `value` slugs, chosen so business logic below and any future
--    application code can resolve "which type is this" without depending on
--    a tenant-editable label string):
--      bel_activiteit  -> Bel activiteit  (icon: Phone)
--      storing         -> Storing         (icon: AlertTriangle)
--      onderhoud       -> Onderhoud       (icon: Settings — a gear, the
--                                          closest existing maintenance-shaped
--                                          icon in packages/ui/src/icons.tsx;
--                                          there is no wrench icon today)
--      afspraak        -> Afspraak        (icon: CalendarDays)
--      email_opvolging -> E-mail opvolging (icon: Mail)
--    `activity_status` is seeded with 3 flat items (Open [default], In
--    behandeling, Afgerond) backing the overview's status badges the
--    acceptance criteria ask for.
--
-- 3. New generic column: `reference_list_items.icon text` (nullable) — the
--    5 `activity_type` items are the first list to use it, but the column
--    itself is deliberately generic/reusable (like `color`), not
--    activities-specific, for any future picklist that wants an icon (e.g. a
--    future Work Order type/category). Value must be an EXACT
--    `@yourorg/ui/icons` export name (checked against
--    `packages/ui/src/icons.tsx` while writing this migration) — the
--    frontend renders it via a lookup into that module's exports, not a
--    free-form icon library reference.
--
-- 4. `validate_activity_relations` (SECURITY DEFINER, same structural style
--    as `validate_work_order_relations`) enforces every cross-field rule
--    the acceptance criteria describe that a plain FK cannot express:
--      - `asset_id`, when set, must belong to the activity's own `client_id`.
--      - `contact_person_id`, when set, must belong to the activity's own
--        `client_id` (not merely the same organization) — same shape as
--        `validate_site_contact_persons` (20260826150000_sites_contact_persons.sql).
--      - `action_holder_id` must be a member of the activity's own
--        organization — mirrors `work_orders.assigned_to`'s validation,
--        applied to a required (not null) column instead of a nullable one.
--      - `asset_id` is REQUIRED when the chosen type's `value` is `storing`
--        or `onderhoud`.
--      - Contact info is REQUIRED when the chosen type's `value` is
--        `bel_activiteit`: either `contact_person_id`, or BOTH
--        `contact_name` AND `contact_phone` (email is never required, even
--        for Bel activiteit, per "Naam, telefoonnummer... Verplicht").
--    The type's `value` is resolved directly off `reference_list_items` by
--    id inside this trigger (not by fragile label-text matching) — the
--    reason the seeded `value` slugs above are chosen deliberately stable.
--
-- 5. Contact override snapshot, NOT written back to `contacts`: an activity
--    stores its own `contact_name`/`contact_phone`/`contact_email` columns,
--    independent of `contact_person_id`. Selecting a contact person is
--    expected to be a UI-layer convenience that COPIES that contact's
--    name/phone into these override columns at creation time (so the
--    activity has a durable point-in-time record even if the contact is
--    later renamed/deleted) — this migration does not enforce or automate
--    that copy (no trigger keeps them in sync with `contacts` on purpose;
--    see the acceptance criterion "dit wordt NIET gecommit als
--    contactpersoon op de klantkaart" — the two are deliberately
--    decoupled after creation). `contact_person_id` itself is `on delete set
--    null` (mirrors `sites.visit_contact_id`) so deleting a contact never
--    blocks or cascades into deleting an activity that merely referenced them.
--
-- 6. RLS/RBAC shape — a NEW combination, not a straight copy of an existing
--    table's shape (per the issue's confirmed permission model): owner/
--    planner CRUD, all rows; engineer create_own/read_own/update_own where
--    "own" = `action_holder_id = auth.uid()` (no delete); finance/
--    administratie read-only, all rows. This combines `time_entries`' engineer
--    INSERT-scoped-to-own-row shape (create_own) with `work_orders`' engineer
--    UPDATE-both-sides-checked shape (an engineer cannot reassign an activity
--    away from themselves, since `WITH CHECK` re-verifies
--    `action_holder_id = auth.uid()` on the new row too) — the first table
--    to need both together, since `time_entries` has no "assigned to someone
--    else" concept and `work_orders`' engineer row has no INSERT at all.
--    `action_holder_id` (not `reported_by`/creator) is what all engineer
--    scoping keys on — the story is explicit that the actiehouder, not the
--    reporter, is the "owner" of a melding going forward.
--
-- 7. `reported_at`/`reported_by` are both permanently non-client-writable
--    (no INSERT or UPDATE column grant at all — not even on insert):
--    `reported_at timestamptz not null default now()` relies purely on its
--    column default (same "immutable audit timestamp" stance `created_at`
--    already has on every table in this schema); `reported_by` is
--    trigger-stamped by a small dedicated trigger (`set_activity_reported_by`)
--    mirroring `set_created_by()` exactly, just targeting a differently-named
--    column (the existing `set_created_by()` function is hardcoded to write
--    `NEW.created_by`, so it can't be reused as-is for a column named
--    `reported_by` — this table intentionally has NO separate `created_by`
--    column, since `reported_by` already serves that exact role per the
--    acceptance criteria's own naming: "Aanmeld persoon (reported_by, the
--    creating user) wordt gevuld, niet bewerkbaar"). Downstream code
--    (api-backend-engineer/frontend-ui-engineer) should reference
--    `activities.reported_by` wherever another table would use `created_by`.
--    `action_holder_id` (unlike `reported_by`) IS updatable after creation
--    ("mag wel worden aangepast na aanmaak").
--
-- 8. Incidental fix, discovered while extending this exact function:
--    `seed_default_reference_lists` is restored here to include the
--    `work_order_status`/`work_order_priority`/`contract_type`/`sla_tier`/
--    `billing_terms`/`time_entry_type`/`quote_status` blocks that
--    `20260826160000_asset_brand_and_models.sql`'s own `create or replace`
--    accidentally dropped (that migration's new version only carried
--    `asset_type`/`asset_status`/`contact_role`/`asset_subtype`/
--    `asset_brand` — a real regression, since `CREATE OR REPLACE FUNCTION`
--    replaces the entire body, not just appends). Every EXISTING
--    organization already has those lists (seeded before the regression, and
--    `on conflict do nothing` throughout makes re-running this function
--    against them a no-op), but any organization created between that
--    migration and this one would have silently been missing 7 reference
--    lists. Restored verbatim from `20260824090000_quotes_core.sql` (the
--    last known-complete version) plus the `asset_brand` block from
--    `20260826160000_asset_brand_and_models.sql`, plus this migration's own
--    new `activity_type`/`activity_status` blocks. Not a scope-creep fix —
--    this migration already has to fully rewrite this function's body to add
--    its own two list_key blocks, so leaving a known-broken body in place
--    would be strictly worse than restoring it in the same edit.
--
-- Column-grant lockdown: new table, so the usual "this project's public
-- schema grants ALL to authenticated/anon by default on new tables" gotcha
-- applies — `revoke all` before the explicit grants (see the two
-- `fix_*_column_grants` migrations for why this matters).

-- ---------------------------------------------------------------------------
-- 0. reference_list_items.icon: new generic, reusable column (design note 3).
-- ---------------------------------------------------------------------------
alter table public.reference_list_items
  add column icon text;

comment on column public.reference_list_items.icon is
  'Optional icon name for reference list items that need one in the UI (e.g. activity_type''s 5 icons, 20260828090000_activities_core.sql). Must be an exact @yourorg/ui/icons export name (e.g. "Phone") — the frontend renders it via a lookup into that module''s exports, not a free-form icon library reference. Nullable and generic/reusable: most reference lists (asset_type, asset_status, etc.) have no icon and this column stays null for their items.';

-- New column on an existing, already-locked-down table: plain additive grant
-- (ALTER TABLE ADD COLUMN does not re-trigger the "grant ALL to authenticated
-- by default on new tables" behavior — see the assets.type_id/status_id
-- grant comment in 20260822200000_reference_lists.sql for the same
-- reasoning).
grant insert (icon) on public.reference_list_items to authenticated;
grant update (icon) on public.reference_list_items to authenticated;

-- ---------------------------------------------------------------------------
-- 1. activities: the melding entity. organization_id is denormalized from
--    clients.organization_id via client_id (design note 1).
-- ---------------------------------------------------------------------------
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  asset_id uuid references public.assets (id) on delete set null,
  type_id uuid not null references public.reference_list_items (id),
  status_id uuid not null references public.reference_list_items (id),
  contact_person_id uuid references public.contacts (id) on delete set null,
  contact_name text,
  contact_phone text,
  contact_email text,
  description text not null,
  reported_at timestamptz not null default now(),
  reported_by uuid references public.users (id) on delete set null,
  -- Required (not null): a required user FK cannot use "on delete set null"
  -- (would violate the not-null constraint) — mirrors the one other
  -- required-user-FK precedent in this schema, time_entries.user_id
  -- (20260823180000_time_entries_core.sql), which also uses "on delete
  -- cascade" rather than "on delete restrict" (not used anywhere in this
  -- schema today).
  action_holder_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.activities is
  'A "melding" (call-back request, storing/fault report, onderhoud, afspraak, or e-mail opvolging) logged against a client, optionally scoped to one asset — the entity that precedes a Work Order (issue #59). organization_id is denormalized from clients.organization_id (via client_id) by derive_activity_organization_id, same reasoning as sites/contacts/work_orders/contracts/quotes. No FK from/to work_orders yet (explicitly out of scope for this migration).';
comment on column public.activities.organization_id is
  'Denormalized from clients.organization_id (via client_id). Never client-writable — see derive_activity_organization_id trigger and the column-level grants below.';
comment on column public.activities.asset_id is
  'Nullable — not every activity is about one specific asset. When set, must belong to the same client_id (validated by validate_activity_relations). REQUIRED (enforced by the same trigger, not a plain NOT NULL, since the requirement is conditional) when the activity''s type_id resolves to the "storing" or "onderhoud" activity_type item.';
comment on column public.activities.type_id is
  'FK into reference_list_items for this organization''s activity_type list (bel_activiteit / storing / onderhoud / afspraak / email_opvolging). Not null, no seeded default and no auto-fill on insert (unlike status_id) — the type picker always requires an explicit choice. Validated by validate_activity_reference_items.';
comment on column public.activities.status_id is
  'FK into reference_list_items for this organization''s activity_status list (Open [default] / In behandeling / Afgerond) — backs the overview''s status badges. Not null; defaults to the org''s default activity_status item when omitted on insert (see derive_activity_organization_id). Validated by validate_activity_reference_items.';
comment on column public.activities.contact_person_id is
  'Optional link to an existing contacts row for this activity''s client. When set, must belong to the same client_id as the activity (validate_activity_relations), not merely the same organization — same shape as sites.visit_contact_id/validate_site_contact_persons. On delete set null (deleting a contact must not block or cascade-delete an activity that merely referenced them). Selecting a contact person is expected to copy their name/phone into contact_name/contact_phone at creation time (UI-layer convenience) — this table does not keep them in sync afterward by design (see migration design note 5); overriding contact_name/contact_phone/contact_email here is NEVER written back onto the contacts row.';
comment on column public.activities.contact_name is
  'Overridable contact name snapshot — independent of contact_person_id, never synced back onto a contacts row. Together with contact_phone, REQUIRED (enforced by validate_activity_relations) when contact_person_id is not set AND the activity''s type is "Bel activiteit".';
comment on column public.activities.contact_phone is
  'Overridable contact phone snapshot. See contact_name comment for the same nullability/requirement rule.';
comment on column public.activities.contact_email is
  'Overridable contact email snapshot. Always optional, even for "Bel activiteit" (only name+phone are required there per the acceptance criteria).';
comment on column public.activities.description is
  'Always required (plain not null) — "Omschrijving is verplicht altijd" per the acceptance criteria, unlike asset_id/contact info which are only conditionally required by type.';
comment on column public.activities.reported_at is
  'Date/time the melding was reported. Not null, defaults to now() at creation, and is permanently non-client-writable (no INSERT or UPDATE column grant at all) — "wordt opgeslagen, niet bewerkbaar" per the acceptance criteria.';
comment on column public.activities.reported_by is
  'The user who created this activity ("Aanmeld persoon"). Trigger-stamped by set_activity_reported_by (mirrors set_created_by(), targeting this differently-named column), never client-writable, and this table deliberately has no separate created_by column — reported_by fills that exact role. Downstream code should treat this the way another table would treat created_by.';
comment on column public.activities.action_holder_id is
  'The user responsible for following up on this melding ("Actiehouder"). Required (not null), must be a member of the activity''s own organization (validate_activity_relations, mirrors work_orders.assigned_to''s validation), and — unlike reported_by — CAN be changed after creation ("mag wel worden aangepast na aanmaak"). This is also the column all engineer RLS scoping (create_own/read_own/update_own) is keyed on.';

create index activities_organization_id_idx on public.activities (organization_id);
create index activities_client_id_idx on public.activities (client_id);
create index activities_asset_id_idx on public.activities (asset_id);
create index activities_type_id_idx on public.activities (type_id);
create index activities_status_id_idx on public.activities (status_id);
create index activities_contact_person_id_idx on public.activities (contact_person_id);
create index activities_reported_by_idx on public.activities (reported_by);
create index activities_action_holder_id_idx on public.activities (action_holder_id);
create index activities_reported_at_idx on public.activities (reported_at);

alter table public.activities enable row level security;
alter table public.activities force row level security;

-- Derives organization_id from client_id (blocking cross-organization
-- re-parenting, same as derive_work_order_organization_id/
-- derive_quote_organization_id), and fills in the organization's default
-- activity_status item when status_id is omitted on insert — folded into
-- this trigger for the usual trigger-ordering reason (organization_id must
-- be known first).
create or replace function public.derive_activity_organization_id()
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
    raise exception 'activities.client_id % does not reference an existing client', new.client_id
      using errcode = '23503';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from v_org_id then
    raise exception 'Cannot move an activity to a client in a different organization'
      using errcode = '23514';
  end if;

  new.organization_id := v_org_id;

  if new.status_id is null then
    select rli.id into new.status_id
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rl.organization_id = v_org_id
      and rl.list_key = 'activity_status'
      and rli.is_default
    limit 1;
  end if;

  return new;
end;
$$;

comment on function public.derive_activity_organization_id() is
  'BEFORE INSERT/UPDATE OF client_id trigger on public.activities: sets organization_id from the referenced client, blocks cross-organization re-parenting, and fills in status_id with the organization''s default activity_status item when the caller omitted it. Runs before validate_activity_relations/validate_activity_reference_items (alphabetically earlier trigger name, same timing), so organization_id and status_id are already final by the time those run.';

create trigger activities_derive_organization_id
  before insert or update of client_id on public.activities
  for each row execute function public.derive_activity_organization_id();

-- Cross-field consistency (design note 4): asset_id/contact_person_id must
-- belong to the activity's own client_id; action_holder_id must be a member
-- of the activity's own organization; asset_id is required for
-- storing/onderhoud; contact info is required for bel_activiteit. SECURITY
-- DEFINER so it can resolve the referenced assets/contacts/memberships rows
-- regardless of the caller's own RLS visibility (mirrors
-- validate_work_order_relations' reasoning).
create or replace function public.validate_activity_relations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset_client_id uuid;
  v_contact_client_id uuid;
  v_action_holder_is_member boolean;
  v_type_value text;
begin
  if new.asset_id is not null then
    select a.client_id into v_asset_client_id
    from public.assets a
    where a.id = new.asset_id;

    if v_asset_client_id is null then
      raise exception 'activities.asset_id % does not reference an existing asset', new.asset_id
        using errcode = '23503';
    elsif v_asset_client_id <> new.client_id then
      raise exception 'activities.asset_id must belong to the same client as the activity'
        using errcode = '23514';
    end if;
  end if;

  if new.contact_person_id is not null then
    select ct.client_id into v_contact_client_id
    from public.contacts ct
    where ct.id = new.contact_person_id;

    if v_contact_client_id is null then
      raise exception 'activities.contact_person_id % does not reference an existing contact', new.contact_person_id
        using errcode = '23503';
    elsif v_contact_client_id <> new.client_id then
      raise exception 'activities.contact_person_id must belong to the same client as the activity'
        using errcode = '23514';
    end if;
  end if;

  if new.action_holder_id is not null then
    select exists (
      select 1
      from public.memberships m
      where m.user_id = new.action_holder_id
        and m.organization_id = new.organization_id
    ) into v_action_holder_is_member;

    if not v_action_holder_is_member then
      raise exception 'activities.action_holder_id must be a member of the same organization as the activity'
        using errcode = '23514';
    end if;
  end if;

  select rli.value into v_type_value
  from public.reference_list_items rli
  where rli.id = new.type_id;

  if v_type_value in ('storing', 'onderhoud') and new.asset_id is null then
    raise exception 'activities.asset_id is required when the activity type is Storing or Onderhoud (type value=%)', v_type_value
      using errcode = '23514';
  end if;

  if v_type_value = 'bel_activiteit'
     and new.contact_person_id is null
     and (new.contact_name is null or new.contact_phone is null) then
    raise exception 'activities.contact_person_id, or both contact_name and contact_phone, is required when the activity type is Bel activiteit'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.validate_activity_relations() is
  'BEFORE INSERT/UPDATE OF client_id, asset_id, contact_person_id, contact_name, contact_phone, action_holder_id, type_id trigger on public.activities: rejects an asset_id/contact_person_id from a different client than the activity''s own client_id, an action_holder_id who is not a member of the activity''s own organization, a missing asset_id when type=storing/onderhoud, and missing contact info when type=bel_activiteit. Resolves the type''s identity by its stable seeded value (not label text). Runs after activities_derive_organization_id (alphabetically later trigger name, same timing), so new.organization_id is already final.';

create trigger activities_validate_relations
  before insert or update of client_id, asset_id, contact_person_id, contact_name, contact_phone, action_holder_id, type_id on public.activities
  for each row execute function public.validate_activity_relations();

-- Validates that type_id/status_id point at an item from the correct
-- list_key, in the activity's own organization. Same structural style as
-- validate_work_order_reference_items.
create or replace function public.validate_activity_reference_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type_org uuid;
  v_type_key text;
  v_status_org uuid;
  v_status_key text;
begin
  select rl.organization_id, rl.list_key into v_type_org, v_type_key
  from public.reference_list_items rli
  join public.reference_lists rl on rl.id = rli.reference_list_id
  where rli.id = new.type_id;

  if v_type_org is null then
    raise exception 'activities.type_id % does not reference an existing reference_list_items row', new.type_id
      using errcode = '23503';
  elsif v_type_key <> 'activity_type' then
    raise exception 'activities.type_id must reference an item from the activity_type reference list (got list_key=%)', v_type_key
      using errcode = '23514';
  elsif v_type_org <> new.organization_id then
    raise exception 'activities.type_id must belong to the same organization as the activity'
      using errcode = '23514';
  end if;

  if new.status_id is not null then
    select rl.organization_id, rl.list_key into v_status_org, v_status_key
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.status_id;

    if v_status_org is null then
      raise exception 'activities.status_id % does not reference an existing reference_list_items row', new.status_id
        using errcode = '23503';
    elsif v_status_key <> 'activity_status' then
      raise exception 'activities.status_id must reference an item from the activity_status reference list (got list_key=%)', v_status_key
        using errcode = '23514';
    elsif v_status_org <> new.organization_id then
      raise exception 'activities.status_id must belong to the same organization as the activity'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_activity_reference_items() is
  'BEFORE INSERT/UPDATE OF type_id, status_id trigger on public.activities: rejects an item from the wrong list_key or a different organization''s reference list. Runs after activities_derive_organization_id (alphabetically later trigger name, same timing), so new.organization_id (and the default-filled status_id) are already final.';

create trigger activities_validate_reference_items
  before insert or update of type_id, status_id on public.activities
  for each row execute function public.validate_activity_reference_items();

-- Dedicated created-by-style trigger targeting reported_by (design note 7) —
-- set_created_by() is hardcoded to NEW.created_by, so it cannot be reused
-- as-is for this differently-named column.
create or replace function public.set_activity_reported_by()
returns trigger
language plpgsql
as $$
begin
  new.reported_by := auth.uid();
  return new;
end;
$$;

comment on function public.set_activity_reported_by() is
  'BEFORE INSERT trigger on public.activities: stamps reported_by to the inserting user, exactly like set_created_by() does for created_by on every other table. A separate function only because the column here is named reported_by, not created_by.';

create trigger activities_set_reported_by
  before insert on public.activities
  for each row execute function public.set_activity_reported_by();

create trigger activities_set_updated_at
  before update on public.activities
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS policies: activities — a new shape (design note 6):
--   owner:                 CRUD, all rows
--   planner:                CRUD, all rows
--   engineer:                create_own/read_own/update_own, where
--                            "own" = action_holder_id = auth.uid(); no delete
--   finance/administratie:   SELECT only, all rows
-- ---------------------------------------------------------------------------

-- SELECT: any member, EXCEPT an engineer, who only sees rows where they are
-- the action holder.
create policy "activities_select_scoped"
on public.activities
for select
to authenticated
using (
  public.is_member_of_org(organization_id)
  and (
    public.current_member_role(organization_id) <> 'engineer'
    or action_holder_id = auth.uid()
  )
);

-- INSERT: owner/planner (any row), or engineer creating an activity with
-- themselves as the action holder (create_own).
create policy "activities_insert_scoped"
on public.activities
for insert
to authenticated
with check (
  public.current_member_role(organization_id) in ('owner', 'planner')
  or (
    public.current_member_role(organization_id) = 'engineer'
    and action_holder_id = auth.uid()
  )
);

-- UPDATE: owner/planner any row; engineer only rows where they are (and,
-- after the update, remain) the action holder — WITH CHECK on the new row
-- stops an engineer from reassigning an activity away from themselves, same
-- protection work_orders_update_scoped applies to assigned_to.
create policy "activities_update_scoped"
on public.activities
for update
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'planner')
  or (
    public.current_member_role(organization_id) = 'engineer'
    and action_holder_id = auth.uid()
  )
)
with check (
  public.current_member_role(organization_id) in ('owner', 'planner')
  or (
    public.current_member_role(organization_id) = 'engineer'
    and action_holder_id = auth.uid()
  )
);

-- DELETE: owner/planner only (engineer has no delete action in the matrix).
create policy "activities_delete_owner_or_planner"
on public.activities
for delete
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'planner')
);

-- New table: this project's public schema grants ALL privileges to
-- authenticated/anon by default on every newly created table — always
-- revoke first (see 20260822193000_fix_clients_sites_assets_column_grants.sql).
revoke all on public.activities from authenticated;

grant select, delete on public.activities to authenticated;
-- organization_id intentionally excluded: derived by
-- derive_activity_organization_id. reported_by intentionally excluded:
-- stamped by set_activity_reported_by. reported_at intentionally excluded
-- from BOTH insert and update: relies purely on its column default, exactly
-- like created_at on every other table (design note 7).
--
-- `id` is included on INSERT (like work_orders' own INSERT grant) so this
-- migration's own RLS test can assign deterministic fixture ids.
grant insert (
  id, client_id, asset_id, type_id, status_id, contact_person_id,
  contact_name, contact_phone, contact_email, description, action_holder_id
) on public.activities to authenticated;
grant update (
  client_id, asset_id, type_id, status_id, contact_person_id,
  contact_name, contact_phone, contact_email, description, action_holder_id
) on public.activities to authenticated;

-- ---------------------------------------------------------------------------
-- Reference lists: activity_type (5 icon-bearing items) and activity_status
-- (3 items, ordered lifecycle). Both flat (no parent_list_key), extending
-- seed_default_reference_lists per its documented extension pattern. This
-- CREATE OR REPLACE also restores the work_order_status/work_order_priority/
-- contract_type/sla_tier/billing_terms/time_entry_type/quote_status blocks
-- that 20260826160000_asset_brand_and_models.sql's own CREATE OR REPLACE
-- accidentally dropped (design note 8) — the full body below is the last
-- known-complete version (from 20260824090000_quotes_core.sql) plus the
-- asset_brand block (from 20260826160000_asset_brand_and_models.sql) plus
-- this migration's own two new blocks.
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
  v_asset_brand_list_id uuid;
  v_activity_type_list_id uuid;
  v_activity_status_list_id uuid;
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

  -- quote_status: for quotes.status_id. Flat list, ordered lifecycle: Draft
  -- (default) -> Sent -> Accepted / Rejected / Expired.
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

  -- asset_brand: for asset_models.brand_item_id. Flat, like
  -- asset_type/asset_status/contact_role — not dependent on anything.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'asset_brand', 'Brand')
  on conflict (organization_id, list_key) do nothing;

  select id into v_asset_brand_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'asset_brand';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_asset_brand_list_id, p_organization_id, 'kyocera', 'Kyocera', 1, false),
    (v_asset_brand_list_id, p_organization_id, 'canon', 'Canon', 2, false),
    (v_asset_brand_list_id, p_organization_id, 'ricoh', 'Ricoh', 3, false),
    (v_asset_brand_list_id, p_organization_id, 'xerox', 'Xerox', 4, false),
    (v_asset_brand_list_id, p_organization_id, 'other_brand', 'Other', 5, true)
  on conflict (reference_list_id, value) do nothing;

  -- activity_type: for activities.type_id (issue #59). Flat list, 5 items,
  -- each carrying an icon (design notes 2-3). No item is marked is_default
  -- — the type picker always requires an explicit choice.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'activity_type', 'Activity Type')
  on conflict (organization_id, list_key) do nothing;

  select id into v_activity_type_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'activity_type';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default, icon)
  values
    (v_activity_type_list_id, p_organization_id, 'bel_activiteit', 'Bel activiteit', 1, false, 'Phone'),
    (v_activity_type_list_id, p_organization_id, 'storing', 'Storing', 2, false, 'AlertTriangle'),
    (v_activity_type_list_id, p_organization_id, 'onderhoud', 'Onderhoud', 3, false, 'Settings'),
    (v_activity_type_list_id, p_organization_id, 'afspraak', 'Afspraak', 4, false, 'CalendarDays'),
    (v_activity_type_list_id, p_organization_id, 'email_opvolging', 'E-mail opvolging', 5, false, 'Mail')
  on conflict (reference_list_id, value) do update set icon = excluded.icon;

  -- activity_status: for activities.status_id (issue #59). Flat list,
  -- ordered lifecycle: Open (default) -> In behandeling -> Afgerond.
  insert into public.reference_lists (organization_id, list_key, name)
  values (p_organization_id, 'activity_status', 'Activity Status')
  on conflict (organization_id, list_key) do nothing;

  select id into v_activity_status_list_id
  from public.reference_lists
  where organization_id = p_organization_id and list_key = 'activity_status';

  insert into public.reference_list_items
    (reference_list_id, organization_id, value, label, sort_order, is_default)
  values
    (v_activity_status_list_id, p_organization_id, 'open', 'Open', 1, true),
    (v_activity_status_list_id, p_organization_id, 'in_progress', 'In behandeling', 2, false),
    (v_activity_status_list_id, p_organization_id, 'completed', 'Afgerond', 3, false)
  on conflict (reference_list_id, value) do nothing;
end;
$$;

comment on function public.seed_default_reference_lists(uuid) is
  'Idempotent (on conflict do nothing throughout, except activity_type''s icon backfill which uses on conflict do update). Called automatically by organizations_seed_reference_lists on every new organization, and once directly in each feature migration to backfill organizations that already existed. Extended in 20260828090000_activities_core.sql with activity_type (flat, 5 icon-bearing items) and activity_status (flat, ordered lifecycle) blocks, and restored the work_order_status/work_order_priority/contract_type/sla_tier/billing_terms/time_entry_type/quote_status blocks that 20260826160000_asset_brand_and_models.sql''s own CREATE OR REPLACE had accidentally dropped (see this migration''s design note 8). Future picklists should extend this function the same way, plus a one-time backfill call in that feature''s own migration.';

-- Backfill: seed the new activity_type/activity_status lists (and restore
-- any list_key block missing due to the 20260826160000 regression) for every
-- organization that already existed before this migration ran — the
-- organizations_seed_reference_lists trigger only fires for future inserts.
do $$
declare
  r record;
begin
  for r in select id from public.organizations loop
    perform public.seed_default_reference_lists(r.id);
  end loop;
end;
$$;
