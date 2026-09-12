import { NextResponse } from "next/server";
import { canAny } from "@yourorg/rbac";

import { getCurrentEngineerSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { todayRangeIso } from "@/lib/today-range";

/**
 * GET /api/workitems/today — today's work orders for the logged-in engineer
 * (issue #169). Mirrors the read path of the root app's `listWorkOrders`
 * (`app/(app)/work-orders/actions.ts`): resolve session -> `canAny()` ->
 * query under the caller's own (RLS-enforced) session. RLS itself already
 * scopes an engineer's `SELECT` on `work_orders` to `assigned_to =
 * auth.uid()` (`work_orders_select_scoped`,
 * `supabase/migrations/20260823120000_work_orders_core.sql`) — deliberately
 * no app-layer `.eq("assigned_to", ...)` filter added on top, same reasoning
 * as `listWorkOrders`'s own comment.
 *
 * Client-side UI/caching is built by a separate effort against this exact
 * response contract — do not change the shape without coordinating.
 */

interface ResolvedReferenceItem {
  value: string;
  label: string;
  color: string | null;
}

interface TodayWorkOrderRow {
  id: string;
  title: string;
  scheduled_at: string | null;
  client: { id: string; name: string } | null;
  site: { id: string; name: string; address_line1: string | null; city: string | null } | null;
  work_order_status: ResolvedReferenceItem | null;
  work_order_type: ResolvedReferenceItem | null;
}

const TODAY_WORK_ORDER_SELECT =
  "id, title, scheduled_at, client:clients(id,name), site:sites(id,name,address_line1,city), work_order_status:reference_list_items!work_orders_status_id_fkey(value,label,color), work_order_type:reference_list_items!work_orders_type_id_fkey(value,label,color)";

export async function GET() {
  const session = await getCurrentEngineerSession();
  if (!session || session.role !== "engineer") {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  if (!canAny({ role: session.role }, "planning", ["read", "read_own"])) {
    return NextResponse.json({ error: "You do not have permission to view work orders." }, { status: 403 });
  }

  const { from, to } = todayRangeIso();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("work_orders")
    .select(TODAY_WORK_ORDER_SELECT)
    .gte("scheduled_at", from)
    .lt("scheduled_at", to)
    .order("scheduled_at", { ascending: true });

  if (error) {
    console.error("GET /api/workitems/today: failed to load work orders", error);
    return NextResponse.json({ error: "Failed to load today's work orders." }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as TodayWorkOrderRow[];

  return NextResponse.json({
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      scheduledAt: row.scheduled_at,
      client: row.client ? { id: row.client.id, name: row.client.name } : null,
      site: row.site
        ? {
            id: row.site.id,
            name: row.site.name,
            addressLine1: row.site.address_line1,
            city: row.site.city,
          }
        : null,
      status: row.work_order_status
        ? { label: row.work_order_status.label, color: row.work_order_status.color }
        : null,
      type: row.work_order_type ? { label: row.work_order_type.label, color: row.work_order_type.color } : null,
    })),
    syncedAt: new Date().toISOString(),
  });
}
