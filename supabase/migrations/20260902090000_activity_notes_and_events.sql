-- Activity Notes + Activity Events (Melding detail redesign,
-- .design-handoff/melding_detail/README.md): two new sections on the new
-- `/activities/[id]` detail page — "Notes" (free-text, user-authored) and
-- "Historie" (an append-only, DB-derived audit timeline of three specific
-- event kinds). Neither table existed before this migration; everything
-- else the design references (activities, work_orders.source_activity_id,
-- activity_type/activity_status reference lists) already exists from
-- `20260828090000_activities_core.sql` / `20260829090000_work_orders_
-- source_activity_id.sql`.
--
-- Design notes (read before extending):
--
-- 1. Visibility mirrors `activities` itself, not a fresh RLS shape: a caller
--    can see (and, for notes, create) a row on these two tables iff they
--    could see/act on the PARENT activity per `activities`' own RLS
--    (owner/planner: any row; engineer: only rows where they are the
--    action holder; finance/administratie: read-only, any row). Rather than
--    join back to `activities` inside every policy (which `time_entries`/
--    `quote_line_items` never need, since their own RLS is flat/org-only —
--    NOT this table's shape), both new tables DENORMALIZE
--    `action_holder_id` from their parent `activities` row, exactly the
--    precedent `work_order_checklists`/`work_order_checklist_items` already
--    set for `assigned_to` in `20260823210000_checklists_core.sql` (see that
--    migration's design note 2: "assigned_to here directly backs an
--    access-control boundary, not just a display field — kept in sync
--    ACTIVELY, drift is not acceptable"). Same reasoning applies here:
--    `activities.action_holder_id` IS editable after creation ("mag wel
--    worden aangepast na aanmaak"), so a note/event created while engineer A
--    was the action holder must become invisible to A (and visible to
--    engineer B) the moment the parent activity is reassigned — a
--    denormalized-but-stale column would silently leak/hide the wrong rows.
--    `activities_sync_dependents_action_holder` (AFTER UPDATE OF
--    action_holder_id on activities) actively re-syncs both tables, mirroring
--    `sync_work_order_checklist_assigned_to` exactly.
--
-- 2. `activity_notes` is an ordinary app-writable child table (a user types
--    a note, same "create_own/update_own N/A here — only CREATE, no
--    UPDATE/no per-row edit" shape the design brief specifies): `organization_id`
--    AND `action_holder_id` are both derived server-side from `activity_id`
--    by `derive_activity_note_fields` (BEFORE INSERT, mirrors
--    `derive_activity_organization_id`'s cross-table-lookup style, but
--    reading from `activities` instead of `clients`), and are excluded from
--    the INSERT column grant entirely — never client-supplied. No UPDATE
--    policy/grant at all (notes aren't edited once posted, per the design
--    brief). DELETE is owner/planner only, mirroring `activities`' own
--    DELETE policy (engineer has no delete there either).
--
-- 3. `activity_events` is NOT a generic every-column audit log — just the
--    three specific event kinds the "Historie" mockup shows (`created`,
--    `action_holder_changed`, `work_order_linked`), append-only, and
--    EXCLUSIVELY DB-trigger-populated:
--      - `create_activity_created_event` (AFTER INSERT on `activities`)
--      - `create_activity_action_holder_changed_event` (AFTER UPDATE OF
--        action_holder_id on `activities`, guarded by a WHEN clause so it
--        only fires on an actual change)
--      - `create_activity_work_order_linked_event` (AFTER INSERT on
--        `work_orders`, guarded by `WHEN (new.source_activity_id is not
--        null)`)
--    All three are SECURITY DEFINER, exactly like `create_work_order_auto_
--    draft_quote`/the `sync_*_to_auto_draft_quote` triggers in
--    `20260901090000_work_order_auto_draft_quotes.sql` — the INSERT into
--    `activity_events` runs as the function-OWNER role, which has BYPASSRLS
--    and full table privileges regardless of any grant made to
--    `authenticated` (same reasoning that migration's header already
--    documents at length; not re-litigated here). This is what lets, e.g.,
--    an engineer's own `create_own`-scoped `activities` INSERT (which they
--    DO have rights for) transitively write a `created` event row (which
--    they do NOT have any direct `activity_events` privilege for at all).
--    **No INSERT/UPDATE/DELETE grant to `authenticated` exists on
--    `activity_events`, period** — not even withheld-by-column-grant like
--    `activity_notes.organization_id`, but absent at the table-grant level
--    entirely. There is no RLS INSERT/UPDATE/DELETE policy either, since
--    none is reachable: a client-side attempt to write this table fails on
--    the missing table privilege before RLS is even consulted. This is the
--    "SECURITY DEFINER trigger function bypasses RLS for the insert" option
--    from the two the task description offered, chosen over a permissive
--    `WITH CHECK (true)` INSERT policy because a table-level grant absence
--    is a strictly stronger guarantee (unreachable by ANY direct client
--    statement, not merely one that happens to fail a same-values check) and
--    is the exact mechanism this schema already established for
--    `quotes.is_auto_draft`-style trigger-only columns/tables.
--
-- 4. `related_work_order_id` is only ever set for a `work_order_linked`
--    event; a CHECK constraint (`activity_events_related_work_order_matches_
--    type`) enforces that pairing declaratively, on top of (not instead of)
--    the trigger only ever populating it that way.
--
-- Column-grant lockdown: two new tables, so the usual "this project's public
-- schema grants ALL to authenticated/anon by default on new tables" gotcha
-- applies to both — `revoke all` before the explicit grants.

-- ---------------------------------------------------------------------------
-- 1. activity_notes
-- ---------------------------------------------------------------------------
create table public.activity_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  activity_id uuid not null references public.activities (id) on delete cascade,
  -- Denormalized from activities.action_holder_id, kept in sync by
  -- activities_sync_dependents_action_holder whenever the parent activity's
  -- action_holder_id changes (design note 1). Not null + on delete cascade,
  -- mirroring activities.action_holder_id's own shape exactly (a required
  -- user FK cannot use "on delete set null").
  action_holder_id uuid not null references public.users (id) on delete cascade,
  body text not null,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint activity_notes_body_not_blank check (btrim(body) <> ''),
  constraint activity_notes_body_max_length check (char_length(body) <= 5000)
);

comment on table public.activity_notes is
  'Free-text notes a user adds to an activity ("melding") — Melding detail page''s Notes section (.design-handoff/melding_detail/README.md). organization_id AND action_holder_id are both denormalized from the parent activities row (via activity_id) by derive_activity_note_fields; action_holder_id is actively kept in sync by activities_sync_dependents_action_holder, since it backs this table''s own RLS visibility boundary, not just a display field (design note 1). No UPDATE policy/grant — notes are never edited once posted.';
comment on column public.activity_notes.organization_id is
  'Denormalized from activities.organization_id (via activity_id). Never client-writable — see derive_activity_note_fields trigger and the column-level grants below.';
comment on column public.activity_notes.action_holder_id is
  'Denormalized from activities.action_holder_id (via activity_id), kept in sync by activities_sync_dependents_action_holder whenever the parent activity is reassigned. Never client-writable. This is the column an engineer caller''s SELECT/INSERT RLS scoping is keyed on (same role as activities.action_holder_id on the activities table itself).';
comment on column public.activity_notes.body is
  'The note text. Required, non-blank (activity_notes_body_not_blank), max 5000 chars (activity_notes_body_max_length) — same length ceiling as activities.description''s own Zod max in app/(app)/activities/schema.ts.';
comment on column public.activity_notes.created_by is
  'The user who posted this note. Trigger-stamped by the existing set_created_by() (reused as-is, not a dedicated function — unlike activities.reported_by, this column IS named created_by). Never client-writable.';

create index activity_notes_organization_id_idx on public.activity_notes (organization_id);
create index activity_notes_activity_id_idx on public.activity_notes (activity_id);
create index activity_notes_action_holder_id_idx on public.activity_notes (action_holder_id);
create index activity_notes_created_by_idx on public.activity_notes (created_by);

alter table public.activity_notes enable row level security;
alter table public.activity_notes force row level security;

-- Derives organization_id AND action_holder_id from activity_id (design
-- note 2) — mirrors derive_activity_organization_id's cross-table-lookup
-- style, reading from activities instead of clients.
create or replace function public.derive_activity_note_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_action_holder_id uuid;
begin
  select a.organization_id, a.action_holder_id
    into v_org_id, v_action_holder_id
  from public.activities a
  where a.id = new.activity_id;

  if v_org_id is null then
    raise exception 'activity_notes.activity_id % does not reference an existing activity', new.activity_id
      using errcode = '23503';
  end if;

  new.organization_id := v_org_id;
  new.action_holder_id := v_action_holder_id;

  return new;
end;
$$;

comment on function public.derive_activity_note_fields() is
  'BEFORE INSERT trigger on public.activity_notes: sets organization_id AND action_holder_id from the referenced activity. activity_id has no UPDATE grant (immutable after creation, see the grants below), so this trigger only needs to run on INSERT — unlike derive_activity_organization_id, which also handles a re-parenting UPDATE case that has no equivalent here.';

create trigger activity_notes_derive_fields
  before insert on public.activity_notes
  for each row execute function public.derive_activity_note_fields();

-- ---------------------------------------------------------------------------
-- RLS policies: activity_notes — visibility/create mirrors the parent
-- activity's own activities_select_scoped/activities_update_scoped (design
-- note 1), keyed on the denormalized action_holder_id column (no join
-- needed). DELETE mirrors activities_delete_owner_or_planner. No UPDATE
-- policy (design note 2).
-- ---------------------------------------------------------------------------

create policy "activity_notes_select_scoped"
on public.activity_notes
for select
to authenticated
using (
  public.is_member_of_org(organization_id)
  and (
    public.current_member_role(organization_id) <> 'engineer'
    or action_holder_id = auth.uid()
  )
);

create policy "activity_notes_insert_scoped"
on public.activity_notes
for insert
to authenticated
with check (
  public.current_member_role(organization_id) in ('owner', 'planner')
  or (
    public.current_member_role(organization_id) = 'engineer'
    and action_holder_id = auth.uid()
  )
);

create policy "activity_notes_delete_owner_or_planner"
on public.activity_notes
for delete
to authenticated
using (
  public.current_member_role(organization_id) in ('owner', 'planner')
);

revoke all on public.activity_notes from authenticated;

grant select, delete on public.activity_notes to authenticated;
-- organization_id/action_holder_id intentionally excluded: derived by
-- derive_activity_note_fields (and kept in sync thereafter by
-- activities_sync_dependents_action_holder). created_by intentionally
-- excluded: stamped by set_created_by. `id` is included on INSERT (like
-- activities' own INSERT grant) so this migration's own RLS test can assign
-- deterministic fixture ids. No UPDATE grant at all.
grant insert (id, activity_id, body) on public.activity_notes to authenticated;

-- ---------------------------------------------------------------------------
-- 2. activity_events
-- ---------------------------------------------------------------------------
create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  activity_id uuid not null references public.activities (id) on delete cascade,
  -- Denormalized from activities.action_holder_id, same sync mechanism and
  -- reasoning as activity_notes.action_holder_id above (design note 1).
  action_holder_id uuid not null references public.users (id) on delete cascade,
  event_type text not null,
  actor_id uuid references public.users (id) on delete set null,
  related_work_order_id uuid references public.work_orders (id) on delete set null,
  occurred_at timestamptz not null default now(),
  constraint activity_events_event_type_valid
    check (event_type in ('created', 'action_holder_changed', 'work_order_linked')),
  constraint activity_events_related_work_order_matches_type
    check (
      (event_type = 'work_order_linked' and related_work_order_id is not null)
      or (event_type <> 'work_order_linked' and related_work_order_id is null)
    )
);

comment on table public.activity_events is
  'Append-only, DB-trigger-populated history/audit timeline for an activity ("melding") — Melding detail page''s Historie section (.design-handoff/melding_detail/README.md). NOT a generic every-column audit log: exactly three event_type kinds, each populated by its own SECURITY DEFINER trigger (see this migration''s header design note 3) — create_activity_created_event (activities AFTER INSERT), create_activity_action_holder_changed_event (activities AFTER UPDATE OF action_holder_id, WHEN changed), create_activity_work_order_linked_event (work_orders AFTER INSERT, WHEN source_activity_id is set). No client-facing INSERT/UPDATE/DELETE grant exists on this table at all — see design note 3 for why that (not a permissive WITH CHECK(true) policy) is the chosen RLS-bypass mechanism for the trigger inserts.';
comment on column public.activity_events.organization_id is
  'Denormalized from the parent activity''s organization_id, set inline by each of the three trigger functions (no separate derive trigger needed — every INSERT into this table is trigger-authored, see design note 3). Never client-writable (no grant at all).';
comment on column public.activity_events.action_holder_id is
  'Denormalized from activities.action_holder_id, set inline at insert time and kept in sync thereafter by activities_sync_dependents_action_holder whenever the parent activity is reassigned (design note 1). This is the column an engineer caller''s SELECT RLS scoping is keyed on.';
comment on column public.activity_events.event_type is
  'One of created / action_holder_changed / work_order_linked (activity_events_event_type_valid) — see this migration''s header design note 3 for what each means and which trigger populates it.';
comment on column public.activity_events.actor_id is
  'The user who caused this event, i.e. auth.uid() at the time (or, for a created event, the new activity''s own reported_by — the creating user). Nullable (e.g. a service-role-driven insert would leave this null, though no such path exists today).';
comment on column public.activity_events.related_work_order_id is
  'Set only for a work_order_linked event (activity_events_related_work_order_matches_type); the work order that was created with this activity as its source_activity_id. on delete set null: deleting that work order later must not delete its own history entry, just sever the link.';

create index activity_events_organization_id_idx on public.activity_events (organization_id);
create index activity_events_activity_id_idx on public.activity_events (activity_id);
create index activity_events_action_holder_id_idx on public.activity_events (action_holder_id);
create index activity_events_event_type_idx on public.activity_events (event_type);
create index activity_events_actor_id_idx on public.activity_events (actor_id);
create index activity_events_related_work_order_id_idx on public.activity_events (related_work_order_id);
create index activity_events_occurred_at_idx on public.activity_events (occurred_at);

alter table public.activity_events enable row level security;
alter table public.activity_events force row level security;

-- ---------------------------------------------------------------------------
-- RLS: SELECT only, same "mirror the parent activity's own visibility" shape
-- as activity_notes above. No INSERT/UPDATE/DELETE policy — unreachable
-- anyway, since no such grant exists on this table for `authenticated`
-- (design note 3).
-- ---------------------------------------------------------------------------

create policy "activity_events_select_scoped"
on public.activity_events
for select
to authenticated
using (
  public.is_member_of_org(organization_id)
  and (
    public.current_member_role(organization_id) <> 'engineer'
    or action_holder_id = auth.uid()
  )
);

revoke all on public.activity_events from authenticated;
grant select on public.activity_events to authenticated;
-- No insert/update/delete grant at all, to any role but the table
-- owner/SECURITY DEFINER function owner — see design note 3. This is
-- deliberately NOT "revoke all, then grant insert to nobody" (a no-op
-- restatement) but a hard guarantee: the SECURITY DEFINER trigger functions
-- below write regardless, since they execute as the function-owner role,
-- which has BYPASSRLS and full table privileges independent of any grant
-- made here to `authenticated`.

-- ---------------------------------------------------------------------------
-- 3. Sync: keep activity_notes.action_holder_id / activity_events.
--    action_holder_id in step with activities.action_holder_id after
--    creation (design note 1) — mirrors sync_work_order_checklist_assigned_to
--    (20260823210000_checklists_core.sql) exactly, just fanned out to two
--    target tables instead of one.
-- ---------------------------------------------------------------------------
create or replace function public.sync_activity_dependents_action_holder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.activity_notes
    set action_holder_id = new.action_holder_id
    where activity_id = new.id;

  update public.activity_events
    set action_holder_id = new.action_holder_id
    where activity_id = new.id;

  return new;
end;
$$;

comment on function public.sync_activity_dependents_action_holder() is
  'AFTER UPDATE OF action_holder_id trigger on public.activities: actively re-syncs the denormalized action_holder_id on every activity_notes/activity_events row for this activity, rather than accepting drift — see this migration''s design note 1 for why this denormalization must not be allowed to go stale (it backs those tables'' own RLS boundary, not just a display field). Mirrors sync_work_order_checklist_assigned_to''s exact reasoning/shape.';

create trigger activities_sync_dependents_action_holder
  after update of action_holder_id on public.activities
  for each row
  when (old.action_holder_id is distinct from new.action_holder_id)
  execute function public.sync_activity_dependents_action_holder();

-- ---------------------------------------------------------------------------
-- 4. Event-creation triggers (design note 3).
-- ---------------------------------------------------------------------------

-- created: AFTER INSERT on activities. Fires once per new activity,
-- unconditionally.
create or replace function public.create_activity_created_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activity_events
    (organization_id, activity_id, action_holder_id, event_type, actor_id, occurred_at)
  values
    (new.organization_id, new.id, new.action_holder_id, 'created', new.reported_by, new.created_at);

  return new;
end;
$$;

comment on function public.create_activity_created_event() is
  'AFTER INSERT trigger on public.activities: logs the created activity_events row. actor_id is the new activity''s own reported_by (the creating user); occurred_at mirrors the activity''s own created_at (not now(), so the two stay identical even if this trigger''s own execution is microseconds later). SECURITY DEFINER — see this migration''s design note 3 for why this INSERT succeeds despite activity_events having no client-facing INSERT grant at all, and regardless of the inserting role''s own privileges on that table (an engineer has none).';

create trigger activities_create_created_event
  after insert on public.activities
  for each row execute function public.create_activity_created_event();

-- action_holder_changed: AFTER UPDATE OF action_holder_id on activities,
-- guarded so it only fires on an actual change.
create or replace function public.create_activity_action_holder_changed_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activity_events
    (organization_id, activity_id, action_holder_id, event_type, actor_id)
  values
    (new.organization_id, new.id, new.action_holder_id, 'action_holder_changed', auth.uid());

  return new;
end;
$$;

comment on function public.create_activity_action_holder_changed_event() is
  'AFTER UPDATE OF action_holder_id trigger on public.activities (WHEN old.action_holder_id IS DISTINCT FROM new.action_holder_id): logs the action_holder_changed activity_events row, actor_id = auth.uid() at the time of the reassignment. SECURITY DEFINER — see design note 3. Registered alongside (not merged into) activities_sync_dependents_action_holder — the two are independent reactions to the same column change (log an event vs. keep two other tables'' denormalized copies current); firing order between them (alphabetical by trigger name) does not matter, since neither reads a value the other writes.';

create trigger activities_create_action_holder_changed_event
  after update of action_holder_id on public.activities
  for each row
  when (old.action_holder_id is distinct from new.action_holder_id)
  execute function public.create_activity_action_holder_changed_event();

-- work_order_linked: AFTER INSERT on work_orders, guarded to only fire when
-- the new work order was created FROM an activity.
create or replace function public.create_activity_work_order_linked_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action_holder_id uuid;
begin
  select a.action_holder_id into v_action_holder_id
  from public.activities a
  where a.id = new.source_activity_id;

  insert into public.activity_events
    (organization_id, activity_id, action_holder_id, event_type, actor_id, related_work_order_id)
  values
    (new.organization_id, new.source_activity_id, v_action_holder_id, 'work_order_linked', auth.uid(), new.id);

  return new;
end;
$$;

comment on function public.create_activity_work_order_linked_event() is
  'AFTER INSERT trigger on public.work_orders (WHEN new.source_activity_id IS NOT NULL): logs a work_order_linked activity_events row on the SOURCE activity. Uses new.organization_id (the work order''s own) rather than re-selecting the activity''s organization_id — safe because validate_work_order_relations (a BEFORE trigger, already run by the time this AFTER trigger fires) already rejected any source_activity_id belonging to a different client (and therefore a different organization) than the work order itself. action_holder_id IS looked up fresh from the activity (no equivalent shortcut available). SECURITY DEFINER — see design note 3.';

create trigger work_orders_create_activity_linked_event
  after insert on public.work_orders
  for each row
  when (new.source_activity_id is not null)
  execute function public.create_activity_work_order_linked_event();
