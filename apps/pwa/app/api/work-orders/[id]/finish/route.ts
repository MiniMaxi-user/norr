import { NextResponse } from "next/server";
import { canAny } from "@yourorg/rbac";

import { getCurrentEngineerSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/work-orders/[id]/finish — marks a work order `completed`
 * (product feedback, 2026-09-12): sets `status_id` to the caller's own
 * organization's `work_order_status` "completed" reference item and stamps
 * `completed_at`. This is the one #170 mutation that IS real/Supabase-
 * backed rather than local-only (unlike timer periods, articles, photos,
 * signatures) — a finished work order has to be visible outside this
 * device (e.g. the desktop planner's board), so it can't stay in the local
 * outbox the way this issue otherwise scopes every other mutation to.
 *
 * Same session -> `canAny()` -> RLS-scoped-query pattern as every other
 * route in this app. `work_orders_update_scoped` (see
 * `supabase/migrations/20260823120000_work_orders_core.sql`) already
 * restricts an engineer's UPDATE to rows where `assigned_to = auth.uid()`
 * — no app-layer `assigned_to` filter added on top, same reasoning as
 * `/api/workitems/today`'s own doc comment. `update_own` is the exact
 * permission-matrix action this needs (`packages/rbac/src/permissions.ts`'s
 * `planning` row already grants `engineer` `read_own`/`update_own`/
 * `create_own`).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid work order id." }, { status: 400 });
  }

  const session = await getCurrentEngineerSession();
  if (!session || session.role !== "engineer") {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  if (!canAny({ role: session.role }, "planning", ["update_own"])) {
    return NextResponse.json({ error: "You do not have permission to update this work order." }, { status: 403 });
  }

  const supabase = await createClient();

  // organization_id, to resolve the CALLER'S OWN org's "completed"
  // work_order_status item below — reference_list_items are tenant-scoped
  // (one row per organization per list_key/value), not a shared global
  // lookup. RLS (`work_orders_select_scoped`) already hides this row
  // entirely if it isn't this engineer's own assigned order, so a 404 here
  // correctly covers both "doesn't exist" and "not yours".
  const { data: workOrder, error: workOrderError } = await supabase
    .from("work_orders")
    .select("organization_id")
    .eq("id", id)
    .maybeSingle();

  if (workOrderError) {
    console.error("POST /api/work-orders/[id]/finish: failed to load work order", workOrderError);
    return NextResponse.json({ error: "Failed to load work order." }, { status: 500 });
  }
  if (!workOrder) {
    return NextResponse.json({ error: "Work order not found." }, { status: 404 });
  }

  const { data: statusList, error: statusListError } = await supabase
    .from("reference_lists")
    .select("id")
    .eq("organization_id", workOrder.organization_id)
    .eq("list_key", "work_order_status")
    .maybeSingle();

  if (statusListError || !statusList) {
    console.error(
      "POST /api/work-orders/[id]/finish: organization has no work_order_status reference list",
      statusListError,
    );
    return NextResponse.json({ error: "Failed to resolve the completed status." }, { status: 500 });
  }

  const { data: completedItem, error: completedItemError } = await supabase
    .from("reference_list_items")
    .select("id")
    .eq("reference_list_id", statusList.id)
    .eq("value", "completed")
    .maybeSingle();

  if (completedItemError || !completedItem) {
    console.error(
      "POST /api/work-orders/[id]/finish: organization's work_order_status list has no 'completed' item",
      completedItemError,
    );
    return NextResponse.json({ error: "Failed to resolve the completed status." }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from("work_orders")
    .update({ status_id: completedItem.id, completed_at: new Date().toISOString() })
    .eq("id", id);

  if (updateError) {
    console.error("POST /api/work-orders/[id]/finish: failed to update work order", updateError);
    return NextResponse.json({ error: "Failed to mark this work order as completed." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
