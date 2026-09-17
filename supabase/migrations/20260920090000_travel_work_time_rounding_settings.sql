-- Travel/work time rounding + minimum billable duration (issue #198,
-- "Afronding reistijd werktijd"). An org owner needs to configure, PER
-- ORGANIZATION and SEPARATELY for travel time vs. work (labor) time: a
-- minimum billable duration, and a rounding interval + direction (e.g. work
-- time always rounds UP to the nearest 30 minutes -- 25min -> 30min; travel
-- time is billed a minimum of 1 hour even if the engineer only traveled
-- 40min). Raw ("gross") `time_entries.started_at`/`ended_at` are NEVER
-- touched by this migration -- they stay exactly as entered; rounding is
-- applied only at READ/COMPUTE time, wherever a "net" (billable) duration is
-- needed. `break` entries are out of scope (never billable, untouched here).
--
-- Two things, in dependency order:
--
-- 1. `organizations.travel_time_minimum_minutes` / `travel_time_rounding_minutes`
--    / `travel_time_rounding_direction`, and the identically-shaped
--    `work_time_*` triple -- six new nullable-by-default columns, EXACT same
--    "plain columns on `organizations`" pattern as
--    `default_travel_article_id`/`default_work_article_id`
--    (`20260901090000_work_order_auto_draft_quotes.sql`) and `own_client_id`
--    (`20260903090000_clients_logo_and_organization_own_client.sql`) -- no
--    generic key/value settings table, matching this codebase's established
--    precedent for org-level configurable business-rule settings. Nullable
--    minimum/rounding columns mean "not configured, no minimum/no rounding
--    applied" for that field -- an org that never visits this settings page
--    keeps today's exact behavior (raw duration, no floor, no rounding).
--    `*_rounding_direction` is `not null default 'up'` (not nullable) even
--    though rounding itself is opt-in via `*_rounding_minutes` being null --
--    a direction value is harmless and meaningless while rounding is off, so
--    there is no reason to allow a third (null) state there; 'up' as the
--    default matches the issue's own leading example ("werktijd rondt altijd
--    naar boven af"). No new RBAC module/feature flag -- gated by the
--    existing `"settings"` module (owner: update, everyone: read) via
--    `requireModuleContext("settings")` + `can(actor, "settings", ...)`,
--    same as `getOrganizationDefaultRateSettings`/
--    `updateOrganizationDefaultRateSettings`
--    (`app/(app)/settings/organization-rate-actions.ts`) already do for
--    `default_travel_article_id`/`default_work_article_id` -- this is core
--    tenant configuration, not a separately-sellable module. No new trigger
--    needed (unlike `default_travel_article_id`/`own_client_id`, these are
--    plain scalars, not FKs into a sibling table needing same-org
--    validation) -- CHECK constraints alone are sufficient.
--
-- 2. `public.compute_rounded_minutes(p_raw_minutes numeric,
--    p_minimum_minutes integer, p_rounding_minutes integer, p_direction
--    text) returns numeric` -- the shared rounding function: floors
--    `p_raw_minutes` at `p_minimum_minutes` (if set) FIRST, then rounds the
--    result up/down to the nearest multiple of `p_rounding_minutes` (if set
--    and > 0), per `p_direction`. Order matters (minimum before rounding) --
--    e.g. work time minimum 15min + rounding 30min/up on a 20min raw entry:
--    floor to 20min (already >= 15min minimum, no change), then round up to
--    30min: 30min. An already-exact multiple of the rounding interval is
--    left alone (not rounded away from itself). IMMUTABLE (pure arithmetic
--    over its own arguments, no table reads) -- safe and cheap to call from
--    both the trigger below and a future application-layer/JS twin.
--    `sync_time_entry_to_auto_draft_quote`
--    (`20260901090000_work_order_auto_draft_quotes.sql`) is updated below to
--    call this, branching travel-vs-work columns on `v_entry_type`, and use
--    the resulting NET minutes (not the raw `v_total_minutes`) for its
--    `v_quantity` computation -- this is the one and only place in the
--    schema that currently computes real invoicing quantity from a time
--    entry's duration.
--
--    **`computeQuantityHours` (`app/(app)/work-orders/create-quote-actions.ts`,
--    ~line 134) is this trigger's documented JS twin, deliberately kept
--    byte-identical to its rounding math per that file's own comment ("kept
--    IDENTICAL to `sync_time_entry_to_auto_draft_quote`'s own rounding...so a
--    quantity never differs between this fallback path and the always-on
--    sync path"). This migration does NOT touch that file -- it now needs a
--    follow-up pass (api-backend-engineer) to read the six new
--    `organizations` columns and apply the equivalent minimum-then-rounding
--    step (ideally via one new shared TS helper mirroring
--    `compute_rounded_minutes`, called from both `computeQuantityHours` and
--    wherever the Settings UI's live preview needs the same math), or its
--    manually-triggered "Create Quote from Work Order" flow will silently
--    diverge from the always-on sync trigger's now-rounded quantities. Left
--    here explicitly so that pass doesn't miss it.**
--
-- ---------------------------------------------------------------------------
-- Due diligence performed before writing this migration:
--   - Grepped `supabase/migrations/` and `supabase/tests/` for
--     `travel_time_minimum_minutes`, `travel_time_rounding_minutes`,
--     `work_time_minimum_minutes`, `work_time_rounding_minutes`, and
--     `compute_rounded_minutes` -- zero hits. All new.
--   - Confirmed `organizations`' baseline grant is still table-wide
--     (`grant select, insert, update on public.organizations to
--     authenticated`, `20260822150910_organizations_memberships_baseline_rls.sql`)
--     and unmodified by every later migration that added its own
--     `organizations` columns (`20260826120000_organizations_is_active.sql`,
--     `20260901090000_work_order_auto_draft_quotes.sql`,
--     `20260903090000_clients_logo_and_organization_own_client.sql`, each per
--     their own header comments) -- so these six new columns need no new
--     GRANT statement either. Actual write access stays gated purely by the
--     existing `organizations_update_owner` RLS policy (`is_org_owner`); this
--     is an existing, already-RLS'd table and this migration does not change
--     who can read/write it, so no new RLS test file and no `qa-reviewer`
--     handoff for this migration (small-edit column-add, not a new table or a
--     tenant-isolation-boundary change).
--   - Re-read `sync_time_entry_to_auto_draft_quote`
--     (`20260901090000_work_order_auto_draft_quotes.sql`, lines ~623-753) in
--     full before touching it -- the only change made below is inserting the
--     org-settings lookup + `compute_rounded_minutes` call between the
--     existing `v_total_minutes` computation and the existing `v_quantity`
--     computation; the running-entry/not-billable/unresolved-rate/re-
--     parenting/upsert logic around it is untouched.
--
-- Out of scope here (api-backend-engineer / frontend-ui-engineer follow-ups):
--   - Settings UI for the six new columns (an owner-only form under
--     Settings, same shape as the existing Default Rates page) and its
--     Server Action (`app/(app)/settings/organization-rate-actions.ts` or a
--     sibling file, following `getOrganizationDefaultRateSettings`/
--     `updateOrganizationDefaultRateSettings`'s exact existing pattern).
--   - `computeQuantityHours`'s matching update, per the note under point 2
--     above.
--   - Any Work Order cost display / invoicing surface that should now show
--     "net (billable)" alongside "gross (actual)" duration.

-- ===========================================================================
-- 1. organizations.travel_time_* / work_time_* rounding + minimum settings
-- ===========================================================================
alter table public.organizations
  add column travel_time_minimum_minutes integer,
  add column travel_time_rounding_minutes integer,
  add column travel_time_rounding_direction text not null default 'up',
  add column work_time_minimum_minutes integer,
  add column work_time_rounding_minutes integer,
  add column work_time_rounding_direction text not null default 'up',
  add constraint organizations_travel_time_minimum_minutes_non_negative
    check (travel_time_minimum_minutes is null or travel_time_minimum_minutes >= 0),
  add constraint organizations_travel_time_rounding_minutes_positive
    check (travel_time_rounding_minutes is null or travel_time_rounding_minutes > 0),
  add constraint organizations_travel_time_rounding_direction_valid
    check (travel_time_rounding_direction in ('up', 'down')),
  add constraint organizations_work_time_minimum_minutes_non_negative
    check (work_time_minimum_minutes is null or work_time_minimum_minutes >= 0),
  add constraint organizations_work_time_rounding_minutes_positive
    check (work_time_rounding_minutes is null or work_time_rounding_minutes > 0),
  add constraint organizations_work_time_rounding_direction_valid
    check (work_time_rounding_direction in ('up', 'down'));

comment on column public.organizations.travel_time_minimum_minutes is
  'Issue #198: minimum BILLABLE travel-time duration in minutes for this org, applied at read/compute time only -- e.g. 60 bills a client a minimum of 1 hour of travel even if the engineer only traveled 40min. Null = no minimum applied (today''s exact behavior). Applied BEFORE travel_time_rounding_minutes by compute_rounded_minutes. Never touches time_entries.started_at/ended_at (raw/gross times are never modified by this feature).';
comment on column public.organizations.travel_time_rounding_minutes is
  'Issue #198: rounding interval in minutes for travel time (e.g. 30 rounds to the nearest half hour), applied at read/compute time only, AFTER travel_time_minimum_minutes. Null = no rounding applied (today''s exact behavior). Direction is travel_time_rounding_direction.';
comment on column public.organizations.travel_time_rounding_direction is
  'Issue #198: ''up'' or ''down'' -- which way travel_time_rounding_minutes rounds a non-exact-multiple duration. not null default ''up'' (harmless/inert while travel_time_rounding_minutes is null, i.e. rounding is off).';
comment on column public.organizations.work_time_minimum_minutes is
  'Issue #198: minimum BILLABLE work (labor) time duration in minutes for this org. See travel_time_minimum_minutes''s comment for the full reasoning (identical, substituting Work/Labor for Travel).';
comment on column public.organizations.work_time_rounding_minutes is
  'Issue #198: rounding interval in minutes for work (labor) time -- e.g. the issue''s own leading example, work time always rounds up to the nearest 30 minutes (25min -> 30min). See travel_time_rounding_minutes''s comment for the full reasoning.';
comment on column public.organizations.work_time_rounding_direction is
  'Issue #198: ''up'' or ''down'' -- which way work_time_rounding_minutes rounds. not null default ''up'', matching the issue''s own leading example (work time rounds up).';

-- No new GRANT statement needed: organizations' baseline grant is table-wide
-- and unmodified (see this migration's header due-diligence note) -- it
-- already covers these six new columns. Actual write access stays gated by
-- the unchanged `organizations_update_owner` RLS policy (is_org_owner), read
-- by the unchanged any-member SELECT policy -- same "settings" RBAC module
-- boundary `default_travel_article_id`/`default_work_article_id` already use
-- at the application layer.

-- ===========================================================================
-- 2. compute_rounded_minutes: shared minimum-then-rounding helper.
-- ===========================================================================
create or replace function public.compute_rounded_minutes(
  p_raw_minutes numeric,
  p_minimum_minutes integer,
  p_rounding_minutes integer,
  p_direction text
)
returns numeric
language plpgsql
immutable
as $$
declare
  v_result numeric;
begin
  v_result := p_raw_minutes;

  -- Minimum floor FIRST (order matters -- see this migration's header).
  if p_minimum_minutes is not null then
    v_result := greatest(v_result, p_minimum_minutes);
  end if;

  -- Rounding interval SECOND, only if configured and positive. Leaves an
  -- already-exact multiple untouched (never rounds a value away from
  -- itself).
  if p_rounding_minutes is not null and p_rounding_minutes > 0 then
    if mod(v_result, p_rounding_minutes::numeric) <> 0 then
      if p_direction = 'down' then
        v_result := floor(v_result / p_rounding_minutes) * p_rounding_minutes;
      else
        v_result := ceil(v_result / p_rounding_minutes) * p_rounding_minutes;
      end if;
    end if;
  end if;

  return v_result;
end;
$$;

comment on function public.compute_rounded_minutes(numeric, integer, integer, text) is
  'Issue #198: applies an optional minimum-duration floor (p_minimum_minutes, applied FIRST) then an optional rounding interval (p_rounding_minutes/p_direction, ''up''/''down'', applied SECOND) to p_raw_minutes. Either or both of p_minimum_minutes/p_rounding_minutes may be null, meaning that step is skipped. An already-exact multiple of p_rounding_minutes is left unchanged. IMMUTABLE (pure arithmetic, no table reads). Called by sync_time_entry_to_auto_draft_quote below, branching organizations.travel_time_*/work_time_* columns on entry type. Has a documented JS twin still to be written in app/(app)/work-orders/create-quote-actions.ts''s computeQuantityHours (see this migration''s header) -- keep any future change to this function''s rounding semantics in sync with that twin.';

revoke all on function public.compute_rounded_minutes(numeric, integer, integer, text) from public;
grant execute on function public.compute_rounded_minutes(numeric, integer, integer, text) to authenticated;

-- ===========================================================================
-- 3. sync_time_entry_to_auto_draft_quote: apply the org's travel/work
--    minimum + rounding settings to the NET minutes used for v_quantity.
--    Everything else about this trigger (billable-type filtering, running-
--    entry handling, re-parenting, rate resolution, upsert) is UNCHANGED --
--    see 20260901090000_work_order_auto_draft_quotes.sql for the full design
--    writeup of the parts not touched here.
-- ===========================================================================
create or replace function public.sync_time_entry_to_auto_draft_quote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quote_id uuid;
  v_old_quote_id uuid;
  v_quote_client_id uuid;
  v_entry_type text;
  v_is_travel boolean;
  v_billable boolean;
  v_total_minutes numeric;
  v_minimum_minutes integer;
  v_rounding_minutes integer;
  v_rounding_direction text;
  v_net_minutes numeric;
  v_quantity numeric;
  v_resolved_article_id uuid;
  v_resolved_sale_price numeric;
  v_resolved_purchase_price numeric;
  v_article_number text;
  v_article_description text;
  v_line_description text;
  v_existing_line_item_id uuid;
begin
  -- work_order_id is NOT immutable on time_entries (unlike
  -- work_order_articles') -- handle re-parenting first: clean up any line
  -- item left behind on the OLD work order's auto-draft quote. This is safe
  -- as an AFTER-trigger delete (unlike the DELETE case above) because it
  -- does not delete the OLD row itself, so no FK ON DELETE action is ever
  -- involved here.
  if tg_op = 'UPDATE' and old.work_order_id is distinct from new.work_order_id then
    select id into v_old_quote_id
      from public.quotes
      where work_order_id = old.work_order_id and is_auto_draft
      limit 1;

    if v_old_quote_id is not null then
      delete from public.quote_line_items
        where source_time_entry_id = old.id and quote_id = v_old_quote_id;
    end if;
  end if;

  select q.id, q.client_id into v_quote_id, v_quote_client_id
    from public.quotes q
    where q.work_order_id = new.work_order_id and q.is_auto_draft
    limit 1;

  -- No auto-draft quote for this work order (never created -- a pre-
  -- migration work order, acceptance criterion 10 -- or already promoted).
  if v_quote_id is null then
    return new;
  end if;

  select rli.value into v_entry_type
    from public.reference_list_items rli
    where rli.id = new.entry_type_id;

  v_billable := coalesce(v_entry_type in ('labor', 'travel'), false);
  v_is_travel := v_entry_type = 'travel';

  -- Not billable (Break, or an unresolved entry_type), or still running (no
  -- ended_at yet) -- no valid line item can exist right now; remove any
  -- stale one from a previous state (e.g. entry_type changed Travel ->
  -- Break, or ended_at was cleared) and stop.
  if not v_billable or new.ended_at is null then
    delete from public.quote_line_items
      where source_time_entry_id = new.id and quote_id = v_quote_id;
    return new;
  end if;

  -- Same whole-minute rounding as createQuoteFromWorkOrder's
  -- computeQuantityHours (app/(app)/work-orders/create-quote-actions.ts) for
  -- deriving the RAW/gross duration -- unchanged. Issue #198: the org's own
  -- travel/work minimum + rounding settings (organizations.travel_time_*/
  -- work_time_*) are then applied to that raw figure via
  -- compute_rounded_minutes to get the NET/billable minutes, which is what
  -- v_quantity is now computed from (previously v_total_minutes directly) --
  -- see this migration's header for the full reasoning, and its note that
  -- computeQuantityHours itself still needs a matching follow-up update.
  v_total_minutes := round(extract(epoch from (new.ended_at - new.started_at))::numeric / 60);

  if v_is_travel then
    select o.travel_time_minimum_minutes, o.travel_time_rounding_minutes, o.travel_time_rounding_direction
      into v_minimum_minutes, v_rounding_minutes, v_rounding_direction
      from public.organizations o
      where o.id = new.organization_id;
  else
    select o.work_time_minimum_minutes, o.work_time_rounding_minutes, o.work_time_rounding_direction
      into v_minimum_minutes, v_rounding_minutes, v_rounding_direction
      from public.organizations o
      where o.id = new.organization_id;
  end if;

  v_net_minutes := public.compute_rounded_minutes(
    v_total_minutes, v_minimum_minutes, v_rounding_minutes, v_rounding_direction
  );

  v_quantity := round((v_net_minutes / 60) * 100) / 100;

  if v_quantity is null or v_quantity <= 0 then
    -- Rounds to 0 hours -- same "treated as unresolvable" rule as the
    -- application-layer path; remove any stale line item and stop.
    delete from public.quote_line_items
      where source_time_entry_id = new.id and quote_id = v_quote_id;
    return new;
  end if;

  select resolved_article_id, resolved_sale_price, resolved_purchase_price
    into v_resolved_article_id, v_resolved_sale_price, v_resolved_purchase_price
    from public.resolve_billing_rate(new.organization_id, v_quote_client_id, new.user_id, v_is_travel);

  if v_resolved_article_id is null then
    -- Unresolved rate: leave this time entry OFF the auto-draft (see
    -- migration header point 6 for why, and how it stays queryable). Remove
    -- any stale line item (e.g. an override that used to resolve was since
    -- removed) and stop.
    delete from public.quote_line_items
      where source_time_entry_id = new.id and quote_id = v_quote_id;
    return new;
  end if;

  select a.article_number, a.description into v_article_number, v_article_description
    from public.articles a
    where a.id = v_resolved_article_id;

  v_line_description := coalesce(v_article_number || ' — ' || v_article_description, 'Time entry');

  select id into v_existing_line_item_id
    from public.quote_line_items
    where source_time_entry_id = new.id and quote_id = v_quote_id;

  if v_existing_line_item_id is not null then
    update public.quote_line_items
      set description = v_line_description,
          quantity = v_quantity,
          unit_price = coalesce(v_resolved_sale_price, 0),
          purchase_price = v_resolved_purchase_price,
          article_id = v_resolved_article_id,
          engineer_user_id = new.user_id
      where id = v_existing_line_item_id;
  else
    insert into public.quote_line_items (
      quote_id, source_time_entry_id, description, quantity, unit_price,
      purchase_price, article_id, engineer_user_id
    ) values (
      v_quote_id, new.id, v_line_description, v_quantity, coalesce(v_resolved_sale_price, 0),
      v_resolved_purchase_price, v_resolved_article_id, new.user_id
    );
  end if;

  return new;
end;
$$;

comment on function public.sync_time_entry_to_auto_draft_quote() is
  'AFTER INSERT/UPDATE trigger on public.time_entries (issue #109; updated by issue #198 to apply org-level travel/work minimum + rounding settings): upserts the corresponding quote_line_items row (matched by source_time_entry_id) on that work order''s is_auto_draft quote, freezing the resolved sale_price/purchase_price at write time. Quantity is now derived from compute_rounded_minutes(raw_minutes, organizations.travel_time_minimum_minutes/travel_time_rounding_minutes/travel_time_rounding_direction OR the work_time_* equivalents per entry type) rather than the raw duration directly -- see 20260920090000_travel_work_time_rounding_settings.sql for the full issue #198 design note. DELETE is handled by the separate BEFORE DELETE trigger/function (sync_time_entry_to_auto_draft_quote_delete, unchanged), not here. SECURITY DEFINER -- lets an engineer''s own time_entries INSERT (which they DO have RLS rights for) transitively write quote_line_items (which they do NOT). No-ops entirely when no is_auto_draft quote exists for the work order (never created, or already promoted -- sync stops permanently on promotion). See 20260901090000_work_order_auto_draft_quotes.sql''s migration header for the full original design reasoning (billable-type filtering, unresolved-rate handling, re-parenting).';

-- Trigger definition itself is unchanged (same function, same timing/events)
-- -- create or replace function above is sufficient, no drop/recreate of the
-- trigger object needed.
