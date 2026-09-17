import { listReferenceItems } from "@/lib/reference-lists/actions";

/**
 * Shared "has this work order already been checked out (or moved further
 * along the lifecycle) by the assigned engineer's PWA?" check — issue #203
 * ("Checkout workitem naar pwa"). Used by `scheduleWorkOrder`/
 * `unscheduleWorkOrder` (`./planning-actions.ts`) and the owner/planner path
 * of `updateWorkOrder`/`deleteWorkOrder` (`./actions.ts`) to reject a
 * PLANNER/OWNER write once `checkout_work_order_if_scheduled`
 * (`supabase/migrations/20260920100000_work_order_checkout_status.sql`) has
 * flipped the row's `status_id` past `scheduled`.
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
