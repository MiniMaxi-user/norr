import { listReferenceItems } from "@/lib/reference-lists/actions";

/**
 * Shared "has this work order already been checked out (or moved further
 * along the lifecycle) by the assigned engineer's PWA?" check — issue #203
 * ("Checkout workitem naar pwa"). Used ONLY by `scheduleWorkOrder`/
 * `unscheduleWorkOrder` (`./planning-actions.ts`) to reject a PLANNER/OWNER
 * reschedule/unschedule once `checkout_work_order_if_scheduled`
 * (`supabase/migrations/20260920100000_work_order_checkout_status.sql`) has
 * flipped the row's `status_id` past `scheduled` — this is the PLANNING
 * BOARD lock (matches `planning-grid.tsx`'s own `isLockedWorkOrder` glanceable
 * icon, which uses the simpler `!== "scheduled"` heuristic for the same
 * population), deliberately UNBOUNDED at the far end: a work order stays
 * un-reschedulable all the way through `to_review`/`completed`/`invoiced`,
 * never just `checkout` through `in_progress` (product feedback, 2026-09-19 —
 * once a job has been dispatched to the field, or finished, the Planning
 * board must never move it again, regardless of how far along it now is).
 *
 * *** NOT used (since 2026-09-19) by `updateWorkOrder`/`deleteWorkOrder`
 * (`./actions.ts`) or the Time Entries/Articles sub-resource actions
 * (`./time-entries-actions.ts`/`./work-order-articles-actions.ts`) any more
 * — those need a DIFFERENT, BOUNDED lock (the work order detail PAGE's own
 * edit-lock, not the Planning board's), see `isWorkOrderCheckedOutInField`
 * below. Product feedback, 2026-09-19: the office needs to correct hours/
 * articles/other fields while a work order is `to_review` (that's the whole
 * point of the review step), and again once `completed`/`invoiced` — only
 * `checkout`/`en_route`/`in_progress` (the engineer is actually out in the
 * field with the PWA) should block the web app's own edit affordances. Two
 * genuinely different questions ("can the Planning board move this block?"
 * vs. "can this page's own fields/Hours/Material be edited right now?"), so
 * two separate functions rather than one with a parameter — deliberately not
 * unified, since conflating them was the actual mistake that had to be fixed.
 *
 * Deliberately a plain shared module, NOT a `"use server"` file, and NOT
 * folded into either `planning-actions.ts` or `actions.ts` directly:
 * `planning-actions.ts` already imports `updateWorkOrder` FROM `./actions.ts`
 * — exporting this helper from either of those two `"use server"` files and
 * importing it from the other would make it a genuine two-way cycle between
 * them. A neutral third module avoids that shape entirely, rather than
 * leaning on the (true, but narrower) fact that Next.js's Server Actions
 * convention only restricts a `"use server"` file's own EXPORTS to async
 * functions — it says nothing about what such a file may import. (Contrast
 * `WORK_ORDER_SELECT`: that's a bare `const` string, which IS disallowed as
 * an export from a `"use server"` file at all, so it's duplicated by hand
 * between the two files instead — a different constraint than this one.)
 *
 * Compares `sort_order`, never an exact string match against `"checkout"` —
 * per the migration's own header design note 4b, this correctly also covers
 * `en_route`/`in_progress`/`completed`/`invoiced`, not just the exact
 * `checkout` state itself.
 *
 * Goes through the same cached `listReferenceItems` read
 * `resolveWorkOrderStatusId` (`./planning-actions.ts`) already uses, rather
 * than a raw query — same reuse-over-reimplement reasoning, and it
 * conveniently also carries the target's OWN status item's `sort_order`
 * (found by matching `statusId` against the same cached items array), so no
 * embedded `reference_list_items` select is needed on the caller's own
 * target-row re-fetch.
 *
 * Fails OPEN (returns `false`, i.e. "not locked") if the org's
 * `work_order_status` list is somehow missing a `checkout` item, or if
 * `statusId` doesn't resolve to any item on that list — should never happen
 * after `seed_default_reference_lists`, but a caller must treat that as
 * "can't evaluate the lock, don't block an otherwise-legitimate write" —
 * same defensive posture `checkout_work_order_if_scheduled` itself takes
 * when its own `checkout` item lookup comes back empty.
 */
export async function isWorkOrderCheckedOutOrLater(statusId: string | null | undefined): Promise<boolean> {
  if (!statusId) return false;

  const result = await listReferenceItems("work_order_status");
  if (!result.data) return false;

  const checkoutItem = result.data.items.find((candidate) => candidate.value === "checkout");
  const statusItem = result.data.items.find((candidate) => candidate.id === statusId);
  if (!checkoutItem || !statusItem) return false;

  return statusItem.sort_order >= checkoutItem.sort_order;
}

/**
 * The work order detail PAGE's own edit-lock (issue #203 follow-up, product
 * feedback 2026-09-19) — a BOUNDED window, `checkout` up to (but excluding)
 * `to_review`: `checkout`/`en_route`/`in_progress` only. Used by
 * `updateWorkOrder`/`deleteWorkOrder` (`./actions.ts`), and every mutating
 * action in `./time-entries-actions.ts`/`./work-order-articles-actions.ts`,
 * to reject a write while the assigned engineer is genuinely still out in the
 * field with the PWA. Once a work order reaches `to_review` (sent back for
 * office review), `completed`, or `invoiced`, this returns `false` again —
 * the office can correct hours/articles/other fields (that's the actual
 * purpose of the review step), unlike the Planning board's OWN lock
 * (`isWorkOrderCheckedOutOrLater` above), which stays locked the whole way
 * through `invoiced` — see this file's own module comment for why these are
 * two separate functions, not one.
 *
 * Same `sort_order`-based comparison, cached-list-read, and fail-OPEN posture
 * as `isWorkOrderCheckedOutOrLater` above — see its own doc comment for the
 * full reasoning on each of those; only the upper bound (`to_review`'s own
 * `sort_order`) is new. Fails open (returns `false`) if the org's
 * `work_order_status` list is somehow missing a `to_review` item too, same
 * defensive posture as a missing `checkout` item.
 */
export async function isWorkOrderCheckedOutInField(statusId: string | null | undefined): Promise<boolean> {
  if (!statusId) return false;

  const result = await listReferenceItems("work_order_status");
  if (!result.data) return false;

  const checkoutItem = result.data.items.find((candidate) => candidate.value === "checkout");
  const toReviewItem = result.data.items.find((candidate) => candidate.value === "to_review");
  const statusItem = result.data.items.find((candidate) => candidate.id === statusId);
  if (!checkoutItem || !toReviewItem || !statusItem) return false;

  return statusItem.sort_order >= checkoutItem.sort_order && statusItem.sort_order < toReviewItem.sort_order;
}
