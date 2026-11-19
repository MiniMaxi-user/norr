import { NextResponse } from "next/server";
import { can } from "@yourorg/rbac";

import { getCurrentEngineerSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/** GET /api/sites/[id]/assets?q= — asset picker for a site (issue #223). */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid site id." }, { status: 400, headers: NO_STORE });

  const session = await getCurrentEngineerSession();
  if (!session || session.role !== "engineer") {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401, headers: NO_STORE });
  }
  if (!can({ role: session.role }, "assets", "read_own")) {
    return NextResponse.json({ error: "You do not have permission to view assets." }, { status: 403, headers: NO_STORE });
  }

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();

  const supabase = await createClient();
  let query = supabase
    .from("assets")
    .select("id, name, serial_number, asset_model:asset_models!assets_model_id_fkey(name)")
    .eq("site_id", id);
  if (q) {
    // Strip PostgREST or() delimiters the user could inject, then escape ilike wildcards.
    const safe = q.replace(/[(),"]/g, " ").replace(/[\\%_]/g, (c) => `\\${c}`);
    query = query.or(`name.ilike.%${safe}%,serial_number.ilike.%${safe}%`);
  }
  const { data, error } = await query.order("name", { ascending: true }).limit(50);

  if (error) {
    console.error("GET /api/sites/[id]/assets: query failed", error);
    return NextResponse.json({ error: "Failed to load assets." }, { status: 500, headers: NO_STORE });
  }

  const rows = (data ?? []) as unknown as {
    id: string;
    name: string;
    serial_number: string | null;
    asset_model: { name: string } | null;
  }[];
  return NextResponse.json(
    {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        serialNumber: r.serial_number,
        modelName: r.asset_model?.name ?? null,
      })),
    },
    { headers: NO_STORE },
  );
}
