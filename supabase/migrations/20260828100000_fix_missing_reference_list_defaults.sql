-- ---------------------------------------------------------------------------
-- Data fix: backfill missing `is_default` flags on reference_list_items.
--
-- Bug: saving an asset failed with `null value in column "status_id" of
-- relation "assets" violates not-null constraint`. Root cause —
-- `derive_asset_org_and_client()` (20260822200000_reference_lists.sql) fills
-- `assets.status_id` from `reference_list_items` where `is_default = true`
-- when the caller omits it, but every organization's `asset_status` list had
-- zero items with `is_default = true`, even though
-- `seed_default_reference_lists()` has always inserted the 'active' item
-- with `is_default = true`.
--
-- Why the seed never actually set it: `seed_default_reference_lists()` is
-- re-run per organization on every feature migration to backfill new
-- list_keys, but every insert in it is `on conflict (reference_list_id,
-- value) do nothing` — required for idempotency, but it also means that once
-- a row exists with the wrong `is_default`, no later re-run of the function
-- can ever correct it (a `do nothing` conflict skips the row entirely). Some
-- organizations' `asset_status` (and several sibling lists') rows were
-- evidently first created with `is_default = false` before this trigger
-- dependency existed or during early iteration, and every later migration's
-- backfill silently left them that way. The same "restore work_order_status/
-- work_order_priority/contract_type/sla_tier/billing_terms/time_entry_type/
-- quote_status" note in 20260828090000_activities_core.sql's own comment on
-- `seed_default_reference_lists` documents this function having already
-- regressed once before in a similar way.
--
-- This isn't just an assets problem: `work_orders.status_id`,
-- `contracts.type_id`, and `quotes.status_id` are all `not null` and rely on
-- the exact same "fill in the org's default reference item" trigger
-- pattern, so any organization missing a default there would hit the
-- identical not-null violation the first time someone created a work order,
-- contract, or quote without explicitly picking one. Fixed here for every
-- list_key that pattern applies to, not just asset_status.
--
-- Fix: for each (list_key, value) pair `seed_default_reference_lists()`
-- intends as the default, set `is_default = true` on that item — but only
-- where the list currently has zero default items, so this never clobbers
-- an org that already has one (including one an org owner deliberately
-- changed via the reference-lists settings UI), and never fights
-- `reference_list_items_one_default_per_list_idx` (at most one default per
-- list). Safe to re-run.
-- ---------------------------------------------------------------------------

update public.reference_list_items i
set is_default = true
from public.reference_lists rl
where rl.id = i.reference_list_id
  and rl.list_key = 'asset_status'
  and i.value = 'active'
  and not exists (
    select 1 from public.reference_list_items d
    where d.reference_list_id = i.reference_list_id and d.is_default
  );

update public.reference_list_items i
set is_default = true
from public.reference_lists rl
where rl.id = i.reference_list_id
  and rl.list_key = 'asset_type'
  and i.value = 'other'
  and not exists (
    select 1 from public.reference_list_items d
    where d.reference_list_id = i.reference_list_id and d.is_default
  );

update public.reference_list_items i
set is_default = true
from public.reference_lists rl
where rl.id = i.reference_list_id
  and rl.list_key = 'contact_role'
  and i.value = 'primary'
  and not exists (
    select 1 from public.reference_list_items d
    where d.reference_list_id = i.reference_list_id and d.is_default
  );

update public.reference_list_items i
set is_default = true
from public.reference_lists rl
where rl.id = i.reference_list_id
  and rl.list_key = 'work_order_status'
  and i.value = 'new'
  and not exists (
    select 1 from public.reference_list_items d
    where d.reference_list_id = i.reference_list_id and d.is_default
  );

update public.reference_list_items i
set is_default = true
from public.reference_lists rl
where rl.id = i.reference_list_id
  and rl.list_key = 'work_order_priority'
  and i.value = 'normal'
  and not exists (
    select 1 from public.reference_list_items d
    where d.reference_list_id = i.reference_list_id and d.is_default
  );

update public.reference_list_items i
set is_default = true
from public.reference_lists rl
where rl.id = i.reference_list_id
  and rl.list_key = 'contract_type'
  and i.value = 'maintenance'
  and not exists (
    select 1 from public.reference_list_items d
    where d.reference_list_id = i.reference_list_id and d.is_default
  );

update public.reference_list_items i
set is_default = true
from public.reference_lists rl
where rl.id = i.reference_list_id
  and rl.list_key = 'billing_terms'
  and i.value = 'monthly'
  and not exists (
    select 1 from public.reference_list_items d
    where d.reference_list_id = i.reference_list_id and d.is_default
  );

update public.reference_list_items i
set is_default = true
from public.reference_lists rl
where rl.id = i.reference_list_id
  and rl.list_key = 'time_entry_type'
  and i.value = 'labor'
  and not exists (
    select 1 from public.reference_list_items d
    where d.reference_list_id = i.reference_list_id and d.is_default
  );

update public.reference_list_items i
set is_default = true
from public.reference_lists rl
where rl.id = i.reference_list_id
  and rl.list_key = 'quote_status'
  and i.value = 'draft'
  and not exists (
    select 1 from public.reference_list_items d
    where d.reference_list_id = i.reference_list_id and d.is_default
  );

update public.reference_list_items i
set is_default = true
from public.reference_lists rl
where rl.id = i.reference_list_id
  and rl.list_key = 'asset_brand'
  and i.value = 'other_brand'
  and not exists (
    select 1 from public.reference_list_items d
    where d.reference_list_id = i.reference_list_id and d.is_default
  );
