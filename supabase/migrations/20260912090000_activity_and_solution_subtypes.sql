-- Activity Sub-type and Solution Sub-type management (combined story, issues
-- #134 "[Story] Beheer Activity subtypes en Solution types" via Settings, and
-- #138 "selecteer ze op de Activity pagina"). This migration is the SCHEMA
-- layer only — the Settings management UI, the cascading dropdowns on the
-- Activity page, and the two RBAC/permission-matrix rows are follow-up work
-- for `api-backend-engineer`/`frontend-ui-engineer`/`auth-rbac-engineer`.
--
-- Two new dedicated, self-referential, unlimited-depth tree tables —
-- `activity_subtypes` and `solution_subtypes` — plus two new nullable FK
-- columns on `activities` recording the single deepest node a user actually
-- picked via #138's cascading dropdowns.
--
-- Design notes (read before extending):
--
-- 1. DEDICATED tables, not the generic `reference_lists`/`reference_list_items`
--    dependent-list mechanism. Same reasoning `article_groups`' own design
--    note 2 (`20260829100000_articles_core.sql`) already gives in full: the
--    generic dependent-list mechanism is single-parent and CROSS-list only
--    (`reference_lists_no_self_parent` explicitly forbids a list depending on
--    itself) — it is structurally incapable of expressing an unlimited-depth
--    tree WITHIN one concept ("Subtype > Sub-subtype > ..."). Both new tables
--    copy `article_groups`' exact shape/mechanics (self-referential parent
--    column, dedicated cycle-detection trigger, same RLS/grant-lockdown
--    structure).
--
-- 2. The one wrinkle `article_groups` doesn't have: `activity_subtypes` is
--    NOT a fully-standalone tree — the ROOT of each branch (no parent) must
--    be linked to an existing `activity_type` reference-list item
--    (`reference_list_items` row with `list_key = 'activity_type'`), and every
--    NON-root node must NOT carry that link (it's implied by walking up to
--    its root). Product-owner phrasing (translated): "Alleen de parent is
--    gelinkt aan een huidig type, alle onderliggende subtypes zijn niet
--    direct gelinked aan een huidig type." This is enforced two ways: (a) a
--    row-level CHECK (`activity_subtypes_root_xor_parent`) that a row has
--    EXACTLY ONE of `parent_subtype_id`/`type_id` set, never both, never
--    neither; (b) `validate_activity_subtype_parent` additionally validates
--    `type_id` itself (correct `list_key`, same organization) whenever it is
--    being set, mirroring `validate_asset_reference_items`'s exact
--    list_key-checking join style. `solution_subtypes` has NEITHER of these —
--    it is never linked to any Type at any level, a fully standalone tree
--    structurally identical to `article_groups` with zero additions.
--
-- 3. `activities.activity_subtype_id` / `activities.solution_subtype_id` are
--    both nullable (not every activity needs one) and store only the single
--    deepest LEAF node the user committed to via the 3-level cascading
--    dropdowns — the same "one committed leaf value, not the whole path"
--    shape `articles.group_id` already uses for its own Group/Subgroup
--    cascade. Neither has an `on delete` clause — like `articles.group_id`,
--    a subtype/solution-subtype still assigned to at least one activity
--    should not be deletable out from under it (a plain FK with no cascade
--    blocks the DELETE with a foreign-key-violation error until every
--    referencing activity is repointed/cleared first).
--
-- 4. The genuinely tricky validation, added to `validate_activity_relations`
--    (extending, not replacing, the trigger `20260907110000_
--    activities_contract_id_revert.sql` left in place): `activity_subtype_id`,
--    when set, must resolve — walking UP its ancestor chain to its root — to
--    a root node whose `type_id` matches the activity's OWN `type_id`. You
--    cannot pick a "Storing" subtype on an activity whose Type is
--    "Onderhoud". Implemented as a small ancestor-walk loop inside the
--    trigger, deliberately reusing the exact depth-capped `while` shape
--    `validate_article_group_parent` already uses for cycle detection (same
--    variable-naming convention: `v_current_id`/`v_next_parent_id`/
--    `v_depth`), just walking to find the root's `type_id` instead of
--    checking for a cycle. `solution_subtype_id` needs no equivalent check
--    (never linked to Type at any level) — just the cross-org check every
--    other activity FK gets.
--
-- 5. **RLS/write boundary — a DELIBERATE DEPARTURE from `article_groups`'
--    "owner or administratie" boundary**: both new tables are OWNER-ONLY for
--    INSERT/UPDATE/DELETE (`is_org_owner(organization_id)`), any org member
--    for SELECT. `article_groups`' broader "owner or administratie" write
--    boundary was a one-off decision specific to the Articles module's own
--    story ("Owner/Administratie beheren de artikel database") — not a
--    precedent to extend by default. Activity Sub-type/Solution type are
--    Settings-configured tenant taxonomies, the same category as the
--    reference-lists/Volume list (issue #131, `20260910090000_
--    reference_list_items_description_active_and_volume_list.sql`), which
--    this codebase already gates owner-only via the `settings` RBAC module
--    and `reference_list_items`' own owner-only write RLS. Reusing that
--    boundary here (rather than article_groups') keeps every Settings-only
--    taxonomy consistent with each other.

-- ---------------------------------------------------------------------------
-- 1. activity_subtypes: dedicated, self-referential, unlimited-depth tree,
--    with the root-must-link-to-activity_type wrinkle (design note 2).
--    organization_id supplied directly on insert (checked by RLS) — same
--    reasoning as article_groups.organization_id (a subtype's only real
--    parent, parent_subtype_id, is itself organization-scoped data, not an
--    unambiguous single row to denormalize from).
-- ---------------------------------------------------------------------------
create table public.activity_subtypes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  parent_subtype_id uuid references public.activity_subtypes (id),
  type_id uuid references public.reference_list_items (id),
  name text not null,
  sort_order integer not null default 0,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activity_subtypes_no_self_parent check (parent_subtype_id is distinct from id),
  -- Design note 2: a root node (no parent) MUST carry the activity_type
  -- link; a non-root node MUST NOT (its type is implied by its ancestry,
  -- resolved by walking up to the root — see validate_activity_relations'
  -- root-type-match check on activities.activity_subtype_id). Exactly one
  -- of the two must be set, never both, never neither.
  constraint activity_subtypes_root_xor_parent check (
    (parent_subtype_id is null and type_id is not null)
    or (parent_subtype_id is not null and type_id is null)
  )
);

comment on table public.activity_subtypes is
  'Tenant-configurable Activity Sub-type tree (Subtype > Sub-subtype, unlimited depth), issues #134/#138. Dedicated table, not a reference_lists list — see the design note at the top of 20260912090000_activity_and_solution_subtypes.sql for why (same reasoning as article_groups). UNLIKE article_groups: every ROOT node (parent_subtype_id is null) must link to an existing activity_type reference_list_items row via type_id; every non-root node must NOT (activity_subtypes_root_xor_parent). Cascade/cycle/type-link integrity is enforced by validate_activity_subtype_parent, not left to the UI. The leaf node a user actually selects on an Activity is stored on activities.activity_subtype_id.';
comment on column public.activity_subtypes.organization_id is
  'Supplied directly on insert, checked by RLS (is_org_owner) — same as article_groups.organization_id, since a subtype''s only real parent (parent_subtype_id) is itself organization-scoped data, not an unambiguous single row to denormalize from.';
comment on column public.activity_subtypes.parent_subtype_id is
  'Self-reference to another activity_subtypes row in the SAME organization, or null for a top-level (root) node. Validated (organization match, no self-reference, no cycle) by validate_activity_subtype_parent. Mutually exclusive with type_id — see activity_subtypes_root_xor_parent.';
comment on column public.activity_subtypes.type_id is
  'FK into reference_list_items for this organization''s activity_type reference list. Set ONLY on a root node (parent_subtype_id is null) — "Alleen de parent is gelinkt aan een huidig type" (issue #134). Every descendant''s effective type is resolved by walking up its ancestor chain to its root, not stored redundantly on every row. Validated (list_key = activity_type + organization match) by validate_activity_subtype_parent, and cross-checked against an activity''s own type_id by validate_activity_relations when this tree''s leaf is selected via activities.activity_subtype_id.';

create index activity_subtypes_organization_id_idx on public.activity_subtypes (organization_id);
create index activity_subtypes_parent_subtype_id_idx on public.activity_subtypes (parent_subtype_id);
create index activity_subtypes_type_id_idx on public.activity_subtypes (type_id);
create index activity_subtypes_created_by_idx on public.activity_subtypes (created_by);

alter table public.activity_subtypes enable row level security;
alter table public.activity_subtypes force row level security;

-- Validates parent_subtype_id (same-organization, no self-reference, no
-- cycle — identical structure to validate_article_group_parent) PLUS, when
-- type_id is being set (a root claim), that it resolves to an actual
-- reference_list_items row with list_key = 'activity_type' in the SAME
-- organization (mirrors validate_asset_reference_items's exact
-- list_key-checking join style).
create or replace function public.validate_activity_subtype_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_org uuid;
  v_current_id uuid;
  v_next_parent_id uuid;
  v_depth integer := 0;
  v_type_org uuid;
  v_type_key text;
begin
  if new.parent_subtype_id is not null then
    if new.parent_subtype_id = new.id then
      raise exception 'activity_subtypes.parent_subtype_id cannot reference itself'
        using errcode = '23514';
    end if;

    select organization_id into v_parent_org
    from public.activity_subtypes
    where id = new.parent_subtype_id;

    if v_parent_org is null then
      raise exception 'activity_subtypes.parent_subtype_id % does not reference an existing activity_subtypes row', new.parent_subtype_id
        using errcode = '23503';
    elsif v_parent_org <> new.organization_id then
      raise exception 'activity_subtypes.parent_subtype_id must belong to the same organization as the subtype'
        using errcode = '23514';
    end if;

    -- Cycle detection: walk up the ancestor chain starting at the intended
    -- parent. If we ever reach this row's own id, setting parent_subtype_id
    -- to new.parent_subtype_id would create a cycle. Depth-capped
    -- defensively (1000 levels), same as validate_article_group_parent.
    v_current_id := new.parent_subtype_id;
    while v_current_id is not null and v_depth <= 1000 loop
      if v_current_id = new.id then
        raise exception 'activity_subtypes.parent_subtype_id would create a cycle in the subtype tree'
          using errcode = '23514';
      end if;

      select parent_subtype_id into v_next_parent_id
      from public.activity_subtypes
      where id = v_current_id;

      v_current_id := v_next_parent_id;
      v_depth := v_depth + 1;
    end loop;
  end if;

  -- Design note 2: type_id is only ever set on a root claim (the CHECK
  -- constraint activity_subtypes_root_xor_parent enforces it can't coexist
  -- with parent_subtype_id) — validate it resolves to a real activity_type
  -- item in this row's own organization, same structural style as
  -- validate_asset_reference_items.
  if new.type_id is not null then
    select rl.organization_id, rl.list_key into v_type_org, v_type_key
    from public.reference_list_items rli
    join public.reference_lists rl on rl.id = rli.reference_list_id
    where rli.id = new.type_id;

    if v_type_org is null then
      raise exception 'activity_subtypes.type_id % does not reference an existing reference_list_items row', new.type_id
        using errcode = '23503';
    elsif v_type_key <> 'activity_type' then
      raise exception 'activity_subtypes.type_id must reference an item from the activity_type reference list (got list_key=%)', v_type_key
        using errcode = '23514';
    elsif v_type_org <> new.organization_id then
      raise exception 'activity_subtypes.type_id must belong to the same organization as the subtype'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_activity_subtype_parent() is
  'BEFORE INSERT/UPDATE OF parent_subtype_id, type_id trigger on public.activity_subtypes: rejects a parent from a different organization, a direct self-reference, or a parent whose ancestor chain loops back to this row (a cycle) — identical structure to validate_article_group_parent. Additionally, when type_id is set (only legal on a root node per activity_subtypes_root_xor_parent), rejects an item from the wrong list_key or a different organization''s activity_type list, mirroring validate_asset_reference_items.';

create trigger activity_subtypes_validate_parent
  before insert or update of parent_subtype_id, type_id on public.activity_subtypes
  for each row execute function public.validate_activity_subtype_parent();

create trigger activity_subtypes_set_created_by
  before insert on public.activity_subtypes
  for each row execute function public.set_created_by();

create trigger activity_subtypes_set_updated_at
  before update on public.activity_subtypes
  for each row execute function public.set_updated_at();

-- RLS: select any org member; write OWNER ONLY — deliberate departure from
-- article_groups' owner-or-administratie boundary, see design note 5 above.
create policy "activity_subtypes_select_member"
on public.activity_subtypes
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "activity_subtypes_insert_owner"
on public.activity_subtypes
for insert
to authenticated
with check (public.is_org_owner(organization_id));

create policy "activity_subtypes_update_owner"
on public.activity_subtypes
for update
to authenticated
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

create policy "activity_subtypes_delete_owner"
on public.activity_subtypes
for delete
to authenticated
using (public.is_org_owner(organization_id));

-- New table: this project's public schema grants ALL privileges to
-- authenticated/anon by default on every newly created table — always
-- revoke first (see 20260822193000_fix_clients_sites_assets_column_grants.sql).
revoke all on public.activity_subtypes from authenticated;

grant select, delete on public.activity_subtypes to authenticated;
-- created_by intentionally excluded: stamped by set_created_by.
grant insert (
  organization_id, parent_subtype_id, type_id, name, sort_order
) on public.activity_subtypes to authenticated;
grant update (
  parent_subtype_id, type_id, name, sort_order
) on public.activity_subtypes to authenticated;

-- ---------------------------------------------------------------------------
-- 2. solution_subtypes: dedicated, self-referential, unlimited-depth tree —
--    structurally IDENTICAL to article_groups, with zero additions (never
--    linked to any Type at any level, per design note 2).
-- ---------------------------------------------------------------------------
create table public.solution_subtypes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  parent_subtype_id uuid references public.solution_subtypes (id),
  name text not null,
  sort_order integer not null default 0,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint solution_subtypes_no_self_parent check (parent_subtype_id is distinct from id)
);

comment on table public.solution_subtypes is
  'Tenant-configurable Solution Sub-type tree (Solution type > Sub-solution type, unlimited depth), issues #134/#138. Dedicated table, structurally IDENTICAL to article_groups (see that table''s own comment/20260829100000_articles_core.sql design note 2) — a fully standalone tree, never linked to any Type at any level (unlike its sibling activity_subtypes). The leaf node a user actually selects on an Activity is stored on activities.solution_subtype_id.';
comment on column public.solution_subtypes.organization_id is
  'Supplied directly on insert, checked by RLS (is_org_owner) — same as article_groups.organization_id / activity_subtypes.organization_id.';
comment on column public.solution_subtypes.parent_subtype_id is
  'Self-reference to another solution_subtypes row in the SAME organization, or null for a top-level node. Validated (organization match, no self-reference, no cycle) by validate_solution_subtype_parent.';

create index solution_subtypes_organization_id_idx on public.solution_subtypes (organization_id);
create index solution_subtypes_parent_subtype_id_idx on public.solution_subtypes (parent_subtype_id);
create index solution_subtypes_created_by_idx on public.solution_subtypes (created_by);

alter table public.solution_subtypes enable row level security;
alter table public.solution_subtypes force row level security;

-- Validates parent_subtype_id: must be a solution_subtypes row in the SAME
-- organization, must not reference itself, and must not create a cycle.
-- Identical structure to validate_article_group_parent — no type-link
-- validation needed (solution_subtypes has no type_id column at all).
create or replace function public.validate_solution_subtype_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_org uuid;
  v_current_id uuid;
  v_next_parent_id uuid;
  v_depth integer := 0;
begin
  if new.parent_subtype_id is null then
    return new;
  end if;

  if new.parent_subtype_id = new.id then
    raise exception 'solution_subtypes.parent_subtype_id cannot reference itself'
      using errcode = '23514';
  end if;

  select organization_id into v_parent_org
  from public.solution_subtypes
  where id = new.parent_subtype_id;

  if v_parent_org is null then
    raise exception 'solution_subtypes.parent_subtype_id % does not reference an existing solution_subtypes row', new.parent_subtype_id
      using errcode = '23503';
  elsif v_parent_org <> new.organization_id then
    raise exception 'solution_subtypes.parent_subtype_id must belong to the same organization as the subtype'
      using errcode = '23514';
  end if;

  -- Cycle detection: walk up the ancestor chain starting at the intended
  -- parent, same depth-capped shape as validate_article_group_parent.
  v_current_id := new.parent_subtype_id;
  while v_current_id is not null and v_depth <= 1000 loop
    if v_current_id = new.id then
      raise exception 'solution_subtypes.parent_subtype_id would create a cycle in the subtype tree'
        using errcode = '23514';
    end if;

    select parent_subtype_id into v_next_parent_id
    from public.solution_subtypes
    where id = v_current_id;

    v_current_id := v_next_parent_id;
    v_depth := v_depth + 1;
  end loop;

  return new;
end;
$$;

comment on function public.validate_solution_subtype_parent() is
  'BEFORE INSERT/UPDATE OF parent_subtype_id trigger on public.solution_subtypes: rejects a parent from a different organization, a direct self-reference, or a parent whose ancestor chain loops back to this row (a cycle). Identical structure to validate_article_group_parent — solution_subtypes has no type-link concept to additionally validate (contrast with validate_activity_subtype_parent).';

create trigger solution_subtypes_validate_parent
  before insert or update of parent_subtype_id on public.solution_subtypes
  for each row execute function public.validate_solution_subtype_parent();

create trigger solution_subtypes_set_created_by
  before insert on public.solution_subtypes
  for each row execute function public.set_created_by();

create trigger solution_subtypes_set_updated_at
  before update on public.solution_subtypes
  for each row execute function public.set_updated_at();

-- RLS: select any org member; write OWNER ONLY (see design note 5).
create policy "solution_subtypes_select_member"
on public.solution_subtypes
for select
to authenticated
using (public.is_member_of_org(organization_id));

create policy "solution_subtypes_insert_owner"
on public.solution_subtypes
for insert
to authenticated
with check (public.is_org_owner(organization_id));

create policy "solution_subtypes_update_owner"
on public.solution_subtypes
for update
to authenticated
using (public.is_org_owner(organization_id))
with check (public.is_org_owner(organization_id));

create policy "solution_subtypes_delete_owner"
on public.solution_subtypes
for delete
to authenticated
using (public.is_org_owner(organization_id));

-- New table: this project's public schema grants ALL privileges to
-- authenticated/anon by default on every newly created table — always
-- revoke first (see 20260822193000_fix_clients_sites_assets_column_grants.sql).
revoke all on public.solution_subtypes from authenticated;

grant select, delete on public.solution_subtypes to authenticated;
-- created_by intentionally excluded: stamped by set_created_by.
grant insert (
  organization_id, parent_subtype_id, name, sort_order
) on public.solution_subtypes to authenticated;
grant update (
  parent_subtype_id, name, sort_order
) on public.solution_subtypes to authenticated;

-- ---------------------------------------------------------------------------
-- 3. activities: two new nullable FK columns storing the single deepest leaf
--    node picked via #138's cascading dropdowns (design note 3). No `on
--    delete` clause — same "block delete while in use" shape articles.group_id
--    uses, since a subtype still assigned to activities shouldn't vanish out
--    from under them.
-- ---------------------------------------------------------------------------
alter table public.activities
  add column activity_subtype_id uuid references public.activity_subtypes (id),
  add column solution_subtype_id uuid references public.solution_subtypes (id);

comment on column public.activities.activity_subtype_id is
  'FK into activity_subtypes — the single deepest leaf node picked via the 3-level cascading Subtype dropdown (issue #138), same "one committed leaf value" shape as articles.group_id. Nullable — not every activity needs one. No ON DELETE clause: a subtype still assigned to at least one activity cannot be deleted out from under it. Validated by validate_activity_relations: must belong to the same organization as the activity, AND (the genuinely tricky part) its ancestor chain, walked up to its root, must resolve to a root node whose type_id matches this activity''s own type_id — you cannot pick a "Storing" subtype on an activity whose Type is "Onderhoud".';
comment on column public.activities.solution_subtype_id is
  'FK into solution_subtypes — the single deepest leaf node picked via the 3-level cascading Solution type dropdown (issue #138), same "one committed leaf value" shape as articles.group_id/activities.activity_subtype_id. Nullable. No ON DELETE clause, same reasoning as activity_subtype_id. Validated by validate_activity_relations: must belong to the same organization as the activity ONLY — solution_subtypes is never linked to Type at any level (design note 2), so no equivalent type-match check applies.';

create index activities_activity_subtype_id_idx on public.activities (activity_subtype_id);
create index activities_solution_subtype_id_idx on public.activities (solution_subtype_id);

-- Extends validate_activity_relations (full body carried forward verbatim
-- from 20260907110000_activities_contract_id_revert.sql, the only other
-- migration that has ever defined it, per this repo's standing "copy the
-- full live body forward" guidance) with the two new cross-field checks.
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
  v_activity_subtype_org uuid;
  v_solution_subtype_org uuid;
  v_current_id uuid;
  v_next_parent_id uuid;
  v_current_type_id uuid;
  v_root_type_id uuid;
  v_depth integer := 0;
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

  -- issue #134/#138: activity_subtype_id, when set, must belong to the same
  -- organization as the activity, AND its ancestor chain (walked up to its
  -- root, exactly the same depth-capped while shape
  -- validate_article_group_parent uses for cycle detection) must resolve to
  -- a root node whose type_id matches this activity's own type_id — you
  -- cannot pick a "Storing" subtype on an activity whose Type is
  -- "Onderhoud".
  if new.activity_subtype_id is not null then
    select organization_id into v_activity_subtype_org
    from public.activity_subtypes
    where id = new.activity_subtype_id;

    if v_activity_subtype_org is null then
      raise exception 'activities.activity_subtype_id % does not reference an existing activity_subtypes row', new.activity_subtype_id
        using errcode = '23503';
    elsif v_activity_subtype_org <> new.organization_id then
      raise exception 'activities.activity_subtype_id must belong to the same organization as the activity'
        using errcode = '23514';
    end if;

    v_current_id := new.activity_subtype_id;
    v_root_type_id := null;
    v_depth := 0;
    while v_current_id is not null and v_depth <= 1000 loop
      select parent_subtype_id, type_id into v_next_parent_id, v_current_type_id
      from public.activity_subtypes
      where id = v_current_id;

      if v_next_parent_id is null then
        -- v_current_id is this chain's root — its type_id is the effective
        -- type for the whole branch (activity_subtypes_root_xor_parent
        -- guarantees a root always carries a non-null type_id).
        v_root_type_id := v_current_type_id;
      end if;

      v_current_id := v_next_parent_id;
      v_depth := v_depth + 1;
    end loop;

    if v_root_type_id is distinct from new.type_id then
      raise exception 'activities.activity_subtype_id''s root subtype type_id must match activities.type_id (cannot pick a subtype from a different activity type''s branch)'
        using errcode = '23514';
    end if;
  end if;

  -- issue #134/#138: solution_subtype_id, when set, must belong to the same
  -- organization as the activity. No type-match check — solution_subtypes
  -- is never linked to Type at any level (design note 2).
  if new.solution_subtype_id is not null then
    select organization_id into v_solution_subtype_org
    from public.solution_subtypes
    where id = new.solution_subtype_id;

    if v_solution_subtype_org is null then
      raise exception 'activities.solution_subtype_id % does not reference an existing solution_subtypes row', new.solution_subtype_id
        using errcode = '23503';
    elsif v_solution_subtype_org <> new.organization_id then
      raise exception 'activities.solution_subtype_id must belong to the same organization as the activity'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.validate_activity_relations() is
  'BEFORE INSERT/UPDATE OF client_id, asset_id, contact_person_id, contact_name, contact_phone, action_holder_id, type_id, activity_subtype_id, solution_subtype_id trigger on public.activities: rejects an asset_id/contact_person_id from a different client than the activity''s own client_id, an action_holder_id who is not a member of the activity''s own organization, a missing asset_id when type=storing/onderhoud, missing contact info when type=bel_activiteit, a cross-org activity_subtype_id/solution_subtype_id, and (issue #134/#138) an activity_subtype_id whose root ancestor''s type_id does not match this activity''s own type_id. Resolves the type''s identity by its stable seeded value (not label text). Runs after activities_derive_organization_id (alphabetically later trigger name, same timing), so new.organization_id is already final. The contract_id check added by 20260907090000_activities_contract_id.sql (issue #127) was reverted the same day by 20260907110000_activities_contract_id_revert.sql (issue #128) — the contract is derived from the linked Asset/Client, not stored.';

drop trigger if exists activities_validate_relations on public.activities;

create trigger activities_validate_relations
  before insert or update of client_id, asset_id, contact_person_id, contact_name, contact_phone, action_holder_id, type_id, activity_subtype_id, solution_subtype_id on public.activities
  for each row execute function public.validate_activity_relations();

-- activity_subtype_id/solution_subtype_id grants: new columns on an
-- already-existing table, not privileges on a newly-created table, so this
-- project's "default privileges grant ALL to authenticated on new tables"
-- gotcha does NOT apply here (see 20260822200000_reference_lists.sql's own
-- note on assets.type_id/status_id for the same reasoning) — public.activities
-- already had `revoke all` applied in 20260828090000_activities_core.sql, so
-- this is a plain additive widening of the existing column-level grants,
-- matching the pattern 20260909100000_contract_line_items_volume_and_
-- purchase_price.sql / 20260911090000_activities_action_holder_nullable.sql
-- already established (re-issue the grant with the new columns added; the
-- original migration files are not edited).
grant insert (activity_subtype_id, solution_subtype_id) on public.activities to authenticated;
grant update (activity_subtype_id, solution_subtype_id) on public.activities to authenticated;
