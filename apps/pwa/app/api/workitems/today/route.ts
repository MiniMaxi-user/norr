import { NextResponse } from "next/server";
import { canAny } from "@yourorg/rbac";

import { getCurrentEngineerSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { todayRangeIso } from "@/lib/today-range";
import type { TimeRoundingSettings } from "@/lib/work-orders/types";

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
 *
 * Issue #198: also returns `timeRoundingSettings` — the caller's org's
 * travel/work minimum + rounding settings (`organizations.travel_time_*`/
 * `work_time_*`, read directly, same shape/approach as
 * `/api/work-orders/[id]`'s own `timeRoundingSettings`) — so this is cached
 * offline before any specific work order is even opened. Adding this field
 * does not need to be coordinated the same way changing an EXISTING field
 * would — it's additive.
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
  // `sites` has no `name` column (dropped by
  // supabase/migrations/20260825120000_sites_drop_name.sql, after the
  // original core migration this select was first written against) — a
  // site is identified by its address only. Selecting `sites.name` made
  // the whole query fail with a Postgres "column does not exist" error,
  // which this route's own catch-all mapped to a generic 500 — silently
  // presented in the UI as "offline"/no data instead of a real error (bug
  // report: an engineer's actual today-work-orders never showed up).
  site: { id: string; address_line1: string | null; city: string | null } | null;
  work_order_status: ResolvedReferenceItem | null;
  work_order_type: ResolvedReferenceItem | null;
  // Added for issue #170's Today screen (IMPLEMENTATION.md §6): the
  // "Urgent" tag/status-pill treatment reads off the work order's
  // *priority* (`urgent`, a `work_order_priority` reference-list value —
  // see supabase/migrations/20260823120000_work_orders_core.sql's seed),
  // not its status — the real `work_order_status` list has no "Urgent"
  // value at all (New -> Scheduled -> En Route -> In Progress -> Completed
  // -> Invoiced).
  work_order_priority: ResolvedReferenceItem | null;
}

const TODAY_WORK_ORDER_SELECT =
  "id, title, scheduled_at, client:clients(id,name), site:sites(id,address_line1,city), work_order_status:reference_list_items!work_orders_status_id_fkey(value,label,color), work_order_type:reference_list_items!work_orders_type_id_fkey(value,label,color), work_order_priority:reference_list_items!work_orders_priority_id_fkey(value,label,color)";

/** Issue #198: the six `organizations` columns behind `timeRoundingSettings`
 * — same direct, minimal-column query as `/api/work-orders/[id]`'s own copy
 * of this (kept as a small local duplicate rather than a shared helper, same
 * granularity this file already keeps its own `TODAY_WORK_ORDER_SELECT`
 * independent of that route's `WORK_ORDER_DETAIL_SELECT`). */
interface OrganizationTimeRoundingRow {
  travel_time_minimum_minutes: number | null;
  travel_time_rounding_minutes: number | null;
  travel_time_rounding_direction: "up" | "down";
  work_time_minimum_minutes: number | null;
  work_time_rounding_minutes: number | null;
  work_time_rounding_direction: "up" | "down";
}

const ORGANIZATION_TIME_ROUNDING_SELECT =
  "travel_time_minimum_minutes, travel_time_rounding_minutes, travel_time_rounding_direction, work_time_minimum_minutes, work_time_rounding_minutes, work_time_rounding_direction";

/** `null`/no-membership fallback: today's exact pre-#198 behavior (no
 * minimum, no rounding) for both travel and work. */
const DEFAULT_TIME_ROUNDING_SETTINGS: TimeRoundingSettings = {
  travel: { minimumMinutes: null, roundingMinutes: null, direction: "up" },
  work: { minimumMinutes: null, roundingMinutes: null, direction: "up" },
};

function toTimeRoundingSettings(row: OrganizationTimeRoundingRow | null): TimeRoundingSettings {
  if (!row) return DEFAULT_TIME_ROUNDING_SETTINGS;
  return {
    travel: {
      minimumMinutes: row.travel_time_minimum_minutes,
      roundingMinutes: row.travel_time_rounding_minutes,
      direction: row.travel_time_rounding_direction,
    },
    work: {
      minimumMinutes: row.work_time_minimum_minutes,
      roundingMinutes: row.work_time_rounding_minutes,
      direction: row.work_time_rounding_direction,
    },
  };
}

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
  const [workOrdersResult, timeRoundingResult] = await Promise.all([
    supabase
      .from("work_orders")
      .select(TODAY_WORK_ORDER_SELECT)
      .gte("scheduled_at", from)
      .lt("scheduled_at", to)
      .order("scheduled_at", { ascending: true }),
    session.organization
      ? supabase
          .from("organizations")
          .select(ORGANIZATION_TIME_ROUNDING_SELECT)
          .eq("id", session.organization.id)
          .maybeSingle<OrganizationTimeRoundingRow>()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (workOrdersResult.error) {
    console.error("GET /api/workitems/today: failed to load work orders", workOrdersResult.error);
    return NextResponse.json({ error: "Failed to load today's work orders." }, { status: 500 });
  }
  if (timeRoundingResult.error) {
    console.error("GET /api/workitems/today: failed to load time rounding settings", timeRoundingResult.error);
    return NextResponse.json({ error: "Failed to load time rounding settings." }, { status: 500 });
  }

  const rows = (workOrdersResult.data ?? []) as unknown as TodayWorkOrderRow[];
  const timeRoundingSettings = toTimeRoundingSettings(
    (timeRoundingResult.data ?? null) as OrganizationTimeRoundingRow | null,
  );

  return NextResponse.json({
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      scheduledAt: row.scheduled_at,
      client: row.client ? { id: row.client.id, name: row.client.name } : null,
      site: row.site
        ? {
            id: row.site.id,
            addressLine1: row.site.address_line1,
            city: row.site.city,
          }
        : null,
      status: row.work_order_status
        ? { label: row.work_order_status.label, color: row.work_order_status.color, value: row.work_order_status.value }
        : null,
      type: row.work_order_type ? { label: row.work_order_type.label, color: row.work_order_type.color } : null,
      isUrgent: row.work_order_priority?.value === "urgent",
    })),
    syncedAt: new Date().toISOString(),
    timeRoundingSettings,
  });
}
