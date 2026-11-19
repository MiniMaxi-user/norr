import { NextResponse } from "next/server";
import { can } from "@yourorg/rbac";

import { getCurrentEngineerSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/work-order-types — the org's `activity_type` items an engineer may
 * pick when creating a work order (issue #223); same value allow-list as the
 * `create_field_work_order` DB function.
 */

const NO_STORE = { "Cache-Control": "no-store" };
const ALLOWED_VALUES = ["storing", "onderhoud", "inspectie"];

export async function GET() {
  const session = await getCurrentEngineerSession();
  if (!session || session.role !== "engineer") {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401, headers: NO_STORE });
  }
  if (!can({ role: session.role }, "planning", "read_own")) {
    return NextResponse.json({ error: "You do not have permission to view work order types." }, { status: 403, headers: NO_STORE });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reference_list_items")
    .select("id, value, label, color, icon, reference_lists!inner(list_key)")
    .eq("reference_lists.list_key", "activity_type")
    .eq("is_active", true)
    .in("value", ALLOWED_VALUES)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("GET /api/work-order-types: query failed", error);
    return NextResponse.json({ error: "Failed to load work order types." }, { status: 500, headers: NO_STORE });
  }

  const rows = (data ?? []) as unknown as {
    id: string;
    value: string;
    label: string;
    color: string | null;
    icon: string | null;
  }[];
  return NextResponse.json(
    { items: rows.map((r) => ({ id: r.id, value: r.value, label: r.label, color: r.color, icon: r.icon })) },
    { headers: NO_STORE },
  );
}
