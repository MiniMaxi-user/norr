import { NextResponse } from "next/server";
import { canAny } from "@yourorg/rbac";

import { getCurrentEngineerSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { currentWeekRangeIso } from "@/lib/week-range";

/**
 * GET /api/engineer/hours-this-week — total logged minutes for the
 * signed-in engineer's own `time_entries` rows started this local week
 * (issue #170's profile sheet, IMPLEMENTATION.md §6: "uren deze week").
 * Same read pattern as the other routes in this app: session ->
 * `canAny()` -> query under RLS, no extra app-layer `user_id` filter
 * needed on top of the explicit `.eq("user_id", ...)` below (RLS still
 * scopes an engineer's own read regardless; the explicit filter here is
 * just "which rows", the same as any other list query, not a substitute
 * for RLS).
 *
 * Deliberately only sums CLOSED entries (`ended_at is not null`) — a
 * currently-running server-side time entry contributes nothing here; the
 * client adds this device's own locally-tracked (not-yet-synced) clock
 * periods on top before rendering the sheet (see `profile-sheet.tsx`), so
 * a still-running "now" isn't silently missing from the total, it's just
 * sourced from the local clock instead of double-counted here.
 */
export async function GET() {
  const session = await getCurrentEngineerSession();
  if (!session || session.role !== "engineer") {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  if (!canAny({ role: session.role }, "planning", ["read", "read_own"])) {
    return NextResponse.json({ error: "You do not have permission to view logged hours." }, { status: 403 });
  }

  const { from, to } = currentWeekRangeIso();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("time_entries")
    .select("started_at, ended_at")
    .eq("user_id", session.userId)
    .not("ended_at", "is", null)
    .gte("started_at", from)
    .lt("started_at", to);

  if (error) {
    console.error("GET /api/engineer/hours-this-week: failed to load time entries", error);
    return NextResponse.json({ error: "Failed to load this week's hours." }, { status: 500 });
  }

  const rows = (data ?? []) as { started_at: string; ended_at: string | null }[];
  const minutes = rows.reduce((sum, row) => {
    if (!row.ended_at) return sum;
    const elapsedMs = new Date(row.ended_at).getTime() - new Date(row.started_at).getTime();
    return sum + Math.max(0, elapsedMs) / 60000;
  }, 0);

  return NextResponse.json({ minutes: Math.round(minutes) });
}
