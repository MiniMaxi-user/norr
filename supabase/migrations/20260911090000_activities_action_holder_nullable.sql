-- Activities: action_holder_id is no longer required (issue #133,
-- "[Story] Aanpassing Activity" — "Action holder is niet meer verplicht").
-- Product-owner reasoning (confirmed before this migration was written):
-- auto-defaulting an omitted action holder to the reporter/creator would be
-- semantically wrong (the reporter is not necessarily who ends up taking
-- ownership of the melding), so the correct fix is to make
-- `activities.action_holder_id` genuinely NULLABLE — "unassigned" becomes a
-- real, representable state, not a value silently defaulted to someone. An
-- unassigned activity can still be assigned later via a plain UPDATE (the
-- column remains editable after creation, unchanged from
-- `20260828090000_activities_core.sql`'s own design note 7).
--
-- Design notes (read before extending):
--
-- 1. `validate_activity_relations` (20260828090000_activities_core.sql,
--    unchanged by 20260907090000/20260907110000's contract_id add/revert)
--    ALREADY guards its own action_holder_id membership check with
--    `if new.action_holder_id is not null then ... end if` — written
--    defensively even while the column was still `not null` at the time. No
--    trigger-logic change is needed there: a NULL action_holder_id now simply
--    skips that membership check entirely (nothing to validate about an
--    absent value), exactly the behavior the story asks for.
--
-- 2. Three columns, not one, need the same constraint dropped —
--    `activity_notes.action_holder_id` and `activity_events.action_holder_id`
--    (both from `20260902090000_activity_notes_and_events.sql`) are
--    denormalized COPIES of `activities.action_holder_id`, both currently
--    `not null`, and both back their own table's "own" RLS visibility clause
--    exactly like `activities.action_holder_id` does on `activities` itself
--    (that migration's design note 1 explicitly calls this out: "not just a
--    display field"). Once an `activities` row can have a NULL
--    action_holder_id, every trigger-driven INSERT into these two tables that
--    copies it verbatim would violate a NOT NULL constraint that no longer
--    matches reality unless it is ALSO relaxed here:
--      - `create_activity_created_event` (AFTER INSERT on activities) inserts
--        a 'created' activity_events row carrying `new.action_holder_id`
--        directly — a brand-new unassigned activity would fail this insert
--        without this column's constraint also being dropped.
--      - `sync_activity_dependents_action_holder` (AFTER UPDATE OF
--        action_holder_id on activities) copies `new.action_holder_id`
--        (which may now be NULL, e.g. an explicit "unassign" update) onto
--        every activity_notes/activity_events row for that activity.
--      - `derive_activity_note_fields` (BEFORE INSERT on activity_notes)
--        copies the parent activity's (possibly NULL) action_holder_id onto
--        a brand-new note row — e.g. a planner posting a note on an
--        unassigned activity.
--      - `create_activity_action_holder_changed_event`/
--        `create_activity_work_order_linked_event`
--        (20260902090000_activity_notes_and_events.sql) and
--        `create_activity_quote_created_event`
--        (20260905090000_activity_solution_and_quote_created_event.sql) all
--        insert a (possibly NULL, looked up fresh from the activity) action
--        holder into activity_events. None of these needed any LOGIC change
--        (each already tolerates a NULL value being carried through — NULL
--        propagates as-is through a plain column copy/lookup with no
--        comparison against it), only this migration's constraint relaxation
--        for the INSERT itself to succeed.
--
-- 3. RLS is NULL-safe on all three tables with NO policy changes needed.
--    Every "own" clause in this schema is written as
--    `current_member_role(organization_id) <> 'engineer' or action_holder_id
--    = auth.uid()` (activities_select_scoped, activity_notes_select_scoped,
--    activity_events_select_scoped) or the INSERT/UPDATE-side mirror
--    `current_member_role(organization_id) = 'engineer' and action_holder_id
--    = auth.uid()` (activities_insert_scoped, activities_update_scoped,
--    activity_notes_insert_scoped). SQL's NULL comparison semantics make this
--    degrade safely with zero code change: `NULL = auth.uid()` evaluates to
--    NULL (neither true nor false), so an unassigned row is simply never
--    "own" to anyone. owner/planner/finance/administratie visibility is
--    entirely unaffected (their branches never reference action_holder_id at
--    all), and an engineer's own SELECT branch correctly falls through to
--    "not visible via own" rather than erroring or (worse) matching
--    everyone's NULL the way `<>`/other comparisons sometimes surprise
--    people with — `=` against NULL is never true, full stop. No test-only
--    behavior here; this is the same guarantee Postgres gives any nullable
--    column compared with `=`.
--
-- 4. Not touched, and correctly so: `activities_insert_scoped`'s engineer
--    branch (`current_member_role(...) = 'engineer' and action_holder_id =
--    auth.uid()`) still means an ENGINEER specifically cannot create an
--    activity with a NULL action_holder_id (NULL = auth.uid() is not true,
--    so their INSERT's WITH CHECK still fails) — only owner/planner can
--    leave it unassigned. That is unchanged, existing behavior from
--    `20260828090000_activities_core.sql`'s create_own shape, not a new
--    restriction introduced here, and is consistent with the story: an
--    engineer's own create_own path is specifically "create for myself",
--    while "leave unassigned for now" is naturally an owner/planner action
--    (they are the ones who see the whole unassigned backlog). No RLS policy
--    edit was made or is needed for this.

alter table public.activities
  alter column action_holder_id drop not null;

comment on column public.activities.action_holder_id is
  'The user responsible for following up on this melding ("Actiehouder"). NULLABLE as of issue #133 ("Action holder is niet meer verplicht") — an unassigned activity is a real, representable state (assignable later via UPDATE), not silently defaulted to the reporter/creator. Still validated by validate_activity_relations to be a member of the activity''s own organization WHEN SET (that trigger already guarded this check with "if new.action_holder_id is not null", so a NULL value simply skips it). Still CAN be changed after creation, either direction (assign, reassign, or unassign back to NULL) — "mag wel worden aangepast na aanmaak". This is also the column all engineer RLS scoping (create_own/read_own/update_own) is keyed on: NULL never equals auth.uid(), so an unassigned activity is correctly invisible via an engineer''s "own" branch on activities_select_scoped/activities_insert_scoped/activities_update_scoped (see this migration''s design note 3) — owner/planner/finance/administratie visibility, none of which references this column, is entirely unaffected.';

alter table public.activity_notes
  alter column action_holder_id drop not null;

comment on column public.activity_notes.action_holder_id is
  'Denormalized from activities.action_holder_id (via activity_id), kept in sync by activities_sync_dependents_action_holder whenever the parent activity is reassigned. NULLABLE as of issue #133, mirroring activities.action_holder_id''s own relaxation — an unassigned activity''s notes simply carry a NULL action_holder_id (derive_activity_note_fields copies whatever the parent activity currently has, including NULL) until the activity is assigned. Never client-writable. This is the column an engineer caller''s SELECT/INSERT RLS scoping is keyed on (same role as activities.action_holder_id on the activities table itself); NULL never equals auth.uid(), so a note on an unassigned activity is correctly invisible via an engineer''s "own" branch, degrading exactly like the parent table (see 20260911090000_activities_action_holder_nullable.sql design note 3) — owner/planner/finance/administratie visibility is unaffected.';

alter table public.activity_events
  alter column action_holder_id drop not null;

comment on column public.activity_events.action_holder_id is
  'Denormalized from activities.action_holder_id, set inline at insert time and kept in sync thereafter by activities_sync_dependents_action_holder whenever the parent activity is reassigned (design note 1, 20260902090000_activity_notes_and_events.sql). NULLABLE as of issue #133, mirroring activities.action_holder_id''s own relaxation — every event-creation trigger that populates this column (create_activity_created_event, create_activity_action_holder_changed_event, create_activity_work_order_linked_event, create_activity_quote_created_event) simply carries through whatever the parent activity''s CURRENT action_holder_id is, including NULL, with no comparison logic that NULL would break. This is the column an engineer caller''s SELECT RLS scoping is keyed on; NULL never equals auth.uid(), so an event on an unassigned activity is correctly invisible via an engineer''s "own" branch, degrading exactly like the parent table (see 20260911090000_activities_action_holder_nullable.sql design note 3) — owner/planner/finance/administratie visibility is unaffected.';
