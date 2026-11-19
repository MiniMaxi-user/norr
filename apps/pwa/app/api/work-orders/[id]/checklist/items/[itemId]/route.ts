import { NextResponse } from "next/server";
import { canAny } from "@yourorg/rbac";

import { getCurrentEngineerSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * PATCH /api/work-orders/[id]/checklist/items/[itemId] — ticks/unticks one
 * item of the work order's standard checklist (issue #230). Body
 * `{ isChecked: boolean }`. Online path; offline the PWA queues the toggle
 * (Dexie `localChecklistToggles`) and sends it with the finish POST.
 *
 * Runs under the engineer's own session: RLS
 * (`work_order_checklist_items_update_scoped`) only lets an engineer update
 * items of work orders assigned to them, and `checked_by`/`checked_at` are
 * trigger-stamped. The item must belong to THIS work order's checklist (404
 * otherwise). 200 `{ itemId, isChecked }`.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(itemId)) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  const session = await getCurrentEngineerSession();
  if (!session || session.role !== "engineer") {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!canAny({ role: session.role }, "checklists", ["update", "update_own"])) {
    return NextResponse.json({ error: "You do not have permission to update checklists." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const isChecked = (body as { isChecked?: unknown } | null)?.isChecked;
  if (typeof isChecked !== "boolean") {
    return NextResponse.json({ error: "isChecked must be true or false." }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: item, error: itemError } = await supabase
    .from("work_order_checklist_items")
    .select("id, checklist:work_order_checklists!inner(work_order_id)")
    .eq("id", itemId)
    .eq("checklist.work_order_id", id)
    .maybeSingle();
  if (itemError) {
    console.error("PATCH /api/work-orders/[id]/checklist/items/[itemId]: failed to load item", itemError);
    return NextResponse.json({ error: "Failed to load the checklist item." }, { status: 500 });
  }
  if (!item) {
    return NextResponse.json({ error: "Checklist item not found." }, { status: 404 });
  }

  const { data: updated, error: updateError } = await supabase
    .from("work_order_checklist_items")
    .update({ is_checked: isChecked })
    .eq("id", itemId)
    .select("id, is_checked")
    .maybeSingle();
  if (updateError) {
    console.error("PATCH /api/work-orders/[id]/checklist/items/[itemId]: update failed", updateError);
    return NextResponse.json({ error: "Failed to save the checklist item." }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "Checklist item not found." }, { status: 404 });
  }
  return NextResponse.json({ itemId, isChecked: (updated as { is_checked: boolean }).is_checked });
}
