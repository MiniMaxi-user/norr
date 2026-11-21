import { NextResponse } from "next/server";
import { can } from "@yourorg/rbac";

import { getCurrentEngineerSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { requireFeature } from "@/lib/features/server";

/**
 * DELETE /api/work-orders/[id]/volumes/[readingId] — removes one of the
 * engineer's OWN asset volume readings (issue #221; readings are immutable,
 * correction = delete + re-add). Own-row scoping is enforced twice: here
 * (`created_by` check) and by RLS (`asset_volume_readings_delete_scoped`).
 * The reading need not belong to this work order (the `[id]` only has to be a
 * valid id). Online-only, see `../route.ts`.
 *
 * 200 `{ deletedId }`; 404 when not found / not own.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; readingId: string }> },
) {
  const { id, readingId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(readingId)) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  const session = await getCurrentEngineerSession();
  if (!session || session.role !== "engineer") {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const metersOff = await requireFeature(session.organization?.id, "meters");
  if (metersOff) return metersOff;
  if (!can({ role: session.role }, "asset_volumes", "delete_own")) {
    return NextResponse.json({ error: "You do not have permission to delete readings." }, { status: 403 });
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("asset_volume_readings")
    .delete()
    .eq("id", readingId)
    .eq("created_by", session.userId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("DELETE /api/work-orders/[id]/volumes/[readingId]: delete failed", error);
    return NextResponse.json({ error: "Failed to delete reading." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Reading not found, or it is not your own." }, { status: 404 });
  }
  return NextResponse.json({ deletedId: (data as { id: string }).id });
}
