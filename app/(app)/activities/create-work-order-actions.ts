"use server";

import { z } from "zod";
import { requireModuleContext } from "@/lib/actions/module-context";
import { ok, fail, type ActionResult } from "@/lib/actions/result";
import { can } from "@/lib/rbac/permissions";
import { getActivity } from "./actions";
import { getAsset } from "@/app/(app)/assets/actions";
import { createWorkOrder, type WorkOrderRecord } from "@/app/(app)/work-orders/actions";

/**
 * "+ Work order" button on the Activity detail page's Linked work orders
 * section (`../components/activity-linked-work-orders.tsx`, issue #152).
 *
 * Issue #152 replaces the issue #118 behavior of navigating to
 * `/work-orders/new?clientId=...&assetId=...&activityId=...` — which itself
 * sometimes immediately redirected on to the new work order's own detail page
 * per `app/(app)/work-orders/new/page.tsx`'s activity-auto-create branch. The
 * reporter wants to stay on the Activity page: clicking the button should
 * just generate the work order in the background, and THEY decide afterwards
 * whether to open or schedule it, via the section's existing per-row
 * Open/Plan buttons.
 *
 * Same field pre-fill as `work-orders/new/page.tsx`'s own auto-create branch
 * (title from `activity_type.label`, description, assignedTo from
 * `action_holder_id`, site inferred transitively through the activity's own
 * asset) — but unlike that branch, this never falls back to a manual form: a
 * missing asset/site here just means the work order is created without one,
 * since the whole point of this entry point is "always generate immediately,
 * no intermediate screen".
 *
 * RBAC: gated on `can(actor, "planning", "create")`, the exact same check
 * `[id]/page.tsx` uses to compute `canCreateWorkOrder` (the prop that decides
 * whether this button even renders) — `createWorkOrder` re-checks it
 * independently regardless, same defense-in-depth every other action in this
 * codebase already has. Reading the source activity goes through the existing
 * `getActivity`, which enforces its own `activities` feature/read gate.
 */
export async function createWorkOrderFromActivity(
  activityId: string,
): Promise<ActionResult<{ workOrder: WorkOrderRecord }>> {
  const idResult = z.string().uuid("Invalid activity id.").safeParse(activityId);
  if (!idResult.success) return fail(idResult.error.issues[0]?.message ?? "Invalid activity id.");

  const activityResult = await getActivity(idResult.data);
  if (!activityResult.data) return fail(activityResult.error ?? "Activity not found.");
  const activity = activityResult.data.activity;

  const ctx = await requireModuleContext("planning");
  if (!ctx.ok) return fail(ctx.error);
  if (!can(ctx.context.actor, "planning", "create")) {
    return fail("Only an owner or planner can create work orders.");
  }

  let siteId: string | undefined;
  if (activity.asset_id) {
    const assetResult = await getAsset(activity.asset_id);
    siteId = assetResult.data?.asset.site_id ?? undefined;
  }

  return createWorkOrder({
    clientId: activity.client_id,
    siteId,
    assetId: activity.asset_id ?? undefined,
    sourceActivityId: activity.id,
    title: activity.activity_type?.label ?? "Work order",
    description: activity.description || undefined,
    assignedTo: activity.action_holder_id ?? undefined,
  });
}
