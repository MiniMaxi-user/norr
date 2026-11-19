import { NextResponse } from "next/server";
import { can } from "@yourorg/rbac";

import { getCurrentEngineerSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/clients/search?q=<text> — client picker for "create work order"
 * (issue #223). Online only; never cached (`no-store`). RLS scopes to the
 * caller's org. `clients` has no archived flag (its `status` is the CRM
 * kanban stage), so no active filter is applied.
 */

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const session = await getCurrentEngineerSession();
  if (!session || session.role !== "engineer") {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401, headers: NO_STORE });
  }
  if (!can({ role: session.role }, "clients", "read_own")) {
    return NextResponse.json({ error: "You do not have permission to view clients." }, { status: 403, headers: NO_STORE });
  }

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ items: [] }, { headers: NO_STORE });

  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, city")
    .ilike("name", `%${escaped}%`)
    .order("name", { ascending: true })
    .limit(20);

  if (error) {
    console.error("GET /api/clients/search: query failed", error);
    return NextResponse.json({ error: "Failed to search clients." }, { status: 500, headers: NO_STORE });
  }

  const rows = (data ?? []) as { id: string; name: string; city: string | null }[];
  return NextResponse.json(
    { items: rows.map((r) => ({ id: r.id, name: r.name, city: r.city })) },
    { headers: NO_STORE },
  );
}
