-- One-time data repair: some organization(s)' `work_order_status`
-- reference list has DUPLICATE `sort_order` values among its items (and
-- correspondingly unused gaps), not merely a non-default custom order.
--
-- Root cause: `20260920100000_work_order_checkout_status.sql` and
-- `20260920110000_work_order_to_review_status.sql` each backfill existing
-- organizations' `work_order_status` items with UPDATEs scoped by
-- `(value = ..., sort_order = <exact expected prior default>)`, deliberately
-- a no-op for any organization whose item didn't sit at that exact expected
-- value — by design, so a tenant that had already hand-reordered the list
-- away from the shipped default wouldn't get clobbered.
--
-- Organization "Norr" (id 6784029f-4619-444b-96b5-25edeaaf0da6) already had
-- a non-default `invoiced` position before those migrations ran, so
-- `invoiced`'s own scoped UPDATE never matched in either migration and never
-- renumbered forward, while `in_progress`'s bump (unrelated to `invoiced`,
-- matched its own expected prior value and fired normally in
-- `20260920100000`) coincidentally landed on the same sort_order Norr's
-- already-customized `invoiced` was sitting at. Confirmed live
-- (`supabase db query --linked`) before writing this migration: Norr reads
-- new=1, scheduled=2, checkout=3, en_route=4, in_progress=5, invoiced=5,
-- completed=6, to_review=6, invoiced=5 (sort_order 5 and 6 each duplicated,
-- 7 and 8 unused) — a genuine tie, not an internally-consistent custom
-- order, so unlike the "never clobber a hand-reordered list" discipline the
-- two migrations above follow, this IS safe (and necessary) to correct: a
-- duplicate sort_order is never a valid customization, it's corruption.
--
-- The other 4 organizations that existed at the time this was investigated
-- (Jansen Client, mjansen1981's organization, LINKIT, Freshfood) were
-- confirmed live to have a clean, sequential 1-8 default order and must NOT
-- be touched.
--
-- Written generically (not hardcoded to Norr's org id), since the same
-- migration-interaction bug could in principle have produced the same
-- duplicate-sort_order corruption for any other organization, past or
-- future, that happened to have a non-default position on one of the
-- affected items before either migration ran:
--
--   For every organization's `work_order_status` reference list, detect
--   whether it currently has any duplicate sort_order value among its items
--   (`group by sort_order having count(*) > 1`, scoped to that org's
--   `reference_list_id`). Only for a list where that's true, reset that
--   list's ENTIRE sort_order back to the canonical value order (new=1,
--   scheduled=2, checkout=3, en_route=4, in_progress=5, to_review=6,
--   completed=7, invoiced=8) via 8 scoped per-value UPDATEs. Any org whose
--   list has no duplicates is left completely alone, even if its order isn't
--   the shipped default — a real, non-duplicate custom reorder is legitimate
--   tenant customization and must be preserved, same discipline as every
--   prior backfill against this list.
--
-- No changes to `seed_default_reference_lists` itself: this is a one-time
-- data repair, not a seeding-path change.
--
-- Note (operational, not part of this migration's own effect): the app's
-- reference-data cache (`lib/cache/reference-data.ts`, `unstable_cache`)
-- will keep serving an affected organization's OLD (broken) order until
-- invalidated. No manual cache-bust is being done here; the existing
-- `updateReferenceItem` reorder path already calls
-- `invalidateReferenceDataCache` on every use, so the very next reorder
-- action against that org's list self-corrects the cache.
do $$
declare
  r record;
  v_dup_count integer;
begin
  for r in
    select rl.id as list_id, rl.organization_id
    from public.reference_lists rl
    where rl.list_key = 'work_order_status'
  loop
    select count(*) into v_dup_count
    from (
      select sort_order
      from public.reference_list_items
      where reference_list_id = r.list_id
      group by sort_order
      having count(*) > 1
    ) dup;

    if v_dup_count > 0 then
      update public.reference_list_items
      set sort_order = 1
      where reference_list_id = r.list_id
        and value = 'new';

      update public.reference_list_items
      set sort_order = 2
      where reference_list_id = r.list_id
        and value = 'scheduled';

      update public.reference_list_items
      set sort_order = 3
      where reference_list_id = r.list_id
        and value = 'checkout';

      update public.reference_list_items
      set sort_order = 4
      where reference_list_id = r.list_id
        and value = 'en_route';

      update public.reference_list_items
      set sort_order = 5
      where reference_list_id = r.list_id
        and value = 'in_progress';

      update public.reference_list_items
      set sort_order = 6
      where reference_list_id = r.list_id
        and value = 'to_review';

      update public.reference_list_items
      set sort_order = 7
      where reference_list_id = r.list_id
        and value = 'completed';

      update public.reference_list_items
      set sort_order = 8
      where reference_list_id = r.list_id
        and value = 'invoiced';
    end if;
  end loop;
end;
$$;
