-- reference_list_items.default_duration_minutes (issue #165, "Op activity
-- subtypes wordt ook Activity type getoond"). Schema layer only — no app/UI
-- changes here (those are api-backend-engineer/frontend-ui-engineer's
-- follow-up passes to build Activity Type management in Settings).
--
-- Background: issue #165 asks for a manageable Activity Type list (already
-- exists as a `reference_list_items` row with `list_key = 'activity_type'`,
-- just with no Settings UI yet — that UI is out of scope for this
-- migration) including a per-type default work-item duration, to later seed
-- a default duration when the planning module creates a work item from an
-- activity of that type. Color is NOT part of this migration: the generic
-- `color` column already exists on this table (used today by e.g. the
-- Volume list) and needs no change.
--
-- New column: a fourth GENERIC, reusable, nullable attribute on
-- `reference_list_items` (same precedent as `color`/`icon`/`description` —
-- see 20260910090000_reference_list_items_description_active_and_volume_
-- list.sql's design note 1 for description/is_active, and
-- 20260828090000_activities_core.sql for icon). Not activity_type-specific
-- even though activity_type is its first real consumer: most lists
-- (priority, status, etc.) will simply leave every item's value null.
--
-- No RLS change: reference_list_items' existing policies
-- (reference_list_items_select_member/_insert_owner/_update_owner/
-- _delete_owner, from 20260822200000_reference_lists.sql) scope by
-- organization membership/ownership only, not by column — adding a nullable
-- column requires no policy change. Column-level INSERT/UPDATE grants ARE
-- reissued below (ALTER TABLE ADD COLUMN doesn't retroactively grant
-- access), in full, per this table's own established pattern.
alter table public.reference_list_items
  add column default_duration_minutes integer,
  add constraint reference_list_items_default_duration_minutes_non_negative
    check (default_duration_minutes is null or default_duration_minutes >= 0);

comment on column public.reference_list_items.default_duration_minutes is
  'Generic optional per-item attribute, like color/icon/description: most reference lists (priority, status, etc.) leave this null. Currently only populated for the activity_type list (issue #165), storing that type''s default work-item duration in minutes. There is no existing interval/duration column convention elsewhere in this schema to match (timestamp pairs like activities.started_at/ended_at are used instead of durations) — this introduces that pattern, consistent with this table''s other optional attribute columns. Intended to seed a default duration when the planning module creates a work item from an activity of this type, once that module exists; no planning-module logic reads it yet. Nullable with no default beyond null; when set, must be >= 0 (reference_list_items_default_duration_minutes_non_negative), mirroring articles_purchase_price_non_negative/articles_sale_price_non_negative''s non-negative-numeric-attribute style.';

revoke all on public.reference_list_items from authenticated;

grant select, delete on public.reference_list_items to authenticated;
-- Full re-issue of the INSERT/UPDATE column-level grants (organization_id
-- excluded throughout: derived by derive_reference_list_item_org.
-- reference_list_id is INSERT-only, still excluded from UPDATE — see design
-- note 4 in 20260822200000_reference_lists.sql, unchanged by this
-- migration).
grant insert (
  reference_list_id, value, label, color, icon, sort_order, is_default,
  parent_item_id, description, is_active, default_duration_minutes
) on public.reference_list_items to authenticated;

grant update (
  value, label, color, icon, sort_order, is_default, parent_item_id,
  description, is_active, default_duration_minutes
) on public.reference_list_items to authenticated;
