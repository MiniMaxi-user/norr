-- Activity "Solution" field + "Quote aangemaakt" history event (issue #121,
-- "Op activity wil ik onder het kopje assignment ook de 'solution' hebben...
-- Ook wil ik belangrijke gebeurtenissen zien bij History zoals, Quote
-- aangemaakt."). Two independent additions on top of
-- `20260828090000_activities_core.sql` / `20260902090000_activity_notes_and_
-- events.sql` — neither touches the other's tables.
--
-- 1. `activities.solution` — a second free-text field alongside `description`,
--    rendered in the Assignment section (same section `description` already
--    lives in, per the issue's own wording) as its own `Textarea`. Unlike
--    `description`, it is OPTIONAL: a melding starts with a problem
--    description and only later, once resolved, gets a solution written down
--    — there is no point in the lifecycle where leaving it blank is invalid.
--    Plain nullable `text`, no length CHECK at the DB layer (same as
--    `quotes.notes`) — `app/(app)/activities/schema.ts`'s `optionalText(5000)`
--    is the only length ceiling, matching every other optional free-text
--    field in that schema.
--
-- 2. `activity_events.related_quote_id` + a new `quote_created` event_type —
--    the third "important event" the issue asks for, alongside the existing
--    `created`/`action_holder_changed`/`work_order_linked`. Populated by a
--    new `create_activity_quote_created_event` trigger (AFTER INSERT ON
--    `quotes`, WHEN `new.work_order_id is not null`), the exact same
--    SECURITY DEFINER / no-client-grant-needed shape
--    `create_activity_work_order_linked_event` already established — see
--    that migration's design note 3 for the full reasoning (not repeated
--    here). The one added wrinkle: a quote links to an ACTIVITY only
--    transitively, via `quotes.work_order_id -> work_orders.source_activity_id`
--    (quotes have no direct FK to activities) — the trigger looks up
--    `source_activity_id` itself and silently no-ops (returns without
--    inserting) when the quote's work order wasn't itself created from an
--    activity. This fires for EVERY quote tied to a work order, not just the
--    system's own auto-draft quote (`is_auto_draft`,
--    `20260901090000_work_order_auto_draft_quotes.sql`) — a later
--    human-authored quote for the same work order is just as much a "Quote
--    aangemaakt" moment on the source activity's timeline.
alter table public.activities
  add column solution text;

comment on column public.activities.solution is
  'Free-text record of how this melding was resolved (issue #121) — same Assignment-section placement and inline-Textarea editing as description, but OPTIONAL (no not-null, no check constraint): a solution is only written once the activity has been worked, unlike description which is required from the moment the melding is reported. Length capped at the application layer only (app/(app)/activities/schema.ts''s optionalText(5000)), same as every other optional free-text field in this schema.';

grant insert (solution) on public.activities to authenticated;
grant update (solution) on public.activities to authenticated;

-- ---------------------------------------------------------------------------
-- activity_events: quote_created
-- ---------------------------------------------------------------------------
alter table public.activity_events
  drop constraint activity_events_event_type_valid;

alter table public.activity_events
  add constraint activity_events_event_type_valid
    check (event_type in ('created', 'action_holder_changed', 'work_order_linked', 'quote_created'));

alter table public.activity_events
  add column related_quote_id uuid references public.quotes (id) on delete set null;

comment on column public.activity_events.related_quote_id is
  'Set only for a quote_created event (activity_events_related_quote_matches_type); the quote that was created against a work order sourced from this activity (via quotes.work_order_id -> work_orders.source_activity_id). on delete set null: deleting that quote later must not delete its own history entry, just sever the link — same reasoning as related_work_order_id.';

alter table public.activity_events
  add constraint activity_events_related_quote_matches_type
    check (
      (event_type = 'quote_created' and related_quote_id is not null)
      or (event_type <> 'quote_created' and related_quote_id is null)
    );

create index activity_events_related_quote_id_idx on public.activity_events (related_quote_id);

-- quote_created: AFTER INSERT on quotes, guarded to only fire when the new
-- quote is tied to a work order at all — most will not resolve to a
-- source_activity_id (an ordinary work order, or a quote with no
-- work_order_id at all), in which case this silently no-ops rather than
-- raising, since "no source activity" is an entirely normal case, not an
-- error.
create or replace function public.create_activity_quote_created_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_activity_id uuid;
  v_action_holder_id uuid;
begin
  select wo.source_activity_id into v_source_activity_id
  from public.work_orders wo
  where wo.id = new.work_order_id;

  if v_source_activity_id is null then
    return new;
  end if;

  select a.action_holder_id into v_action_holder_id
  from public.activities a
  where a.id = v_source_activity_id;

  insert into public.activity_events
    (organization_id, activity_id, action_holder_id, event_type, actor_id, related_quote_id)
  values
    (new.organization_id, v_source_activity_id, v_action_holder_id, 'quote_created', auth.uid(), new.id);

  return new;
end;
$$;

comment on function public.create_activity_quote_created_event() is
  'AFTER INSERT trigger on public.quotes (WHEN new.work_order_id IS NOT NULL): logs a quote_created activity_events row on the activity the quote''s work order was itself sourced from, if any (quotes have no direct FK to activities — this resolves the link transitively via work_orders.source_activity_id, no-opping when that''s null). Uses new.organization_id (the quote''s own) rather than re-selecting the activity''s organization_id — safe because validate_quote_relations (a BEFORE trigger, already run by the time this AFTER trigger fires) already rejected any work_order_id belonging to a different client (and therefore a different organization) than the quote itself. SECURITY DEFINER — see 20260902090000_activity_notes_and_events.sql''s design note 3 for why this INSERT succeeds despite activity_events having no client-facing INSERT grant at all.';

create trigger quotes_create_activity_linked_event
  after insert on public.quotes
  for each row
  when (new.work_order_id is not null)
  execute function public.create_activity_quote_created_event();
