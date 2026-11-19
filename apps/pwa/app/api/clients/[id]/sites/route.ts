import { NextResponse } from "next/server";
import { can } from "@yourorg/rbac";

import { getCurrentEngineerSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/** GET /api/clients/[id]/sites — sites of a client (issue #223). `sites` has no `name` column. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid client id." }, { status: 400, headers: NO_STORE });

  const session = await getCurrentEngineerSession();
  if (!session || session.role !== "engineer") {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401, headers: NO_STORE });
  }
  if (!can({ role: session.role }, "clients", "read_own")) {
    return NextResponse.json({ error: "You do not have permission to view sites." }, { status: 403, headers: NO_STORE });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("sites")
    .select("id, address_line1, postal_code, city")
    .eq("client_id", id)
    .order("address_line1", { ascending: true })
    .order("city", { ascending: true });

  if (error) {
    console.error("GET /api/clients/[id]/sites: query failed", error);
    return NextResponse.json({ error: "Failed to load sites." }, { status: 500, headers: NO_STORE });
  }

  const rows = (data ?? []) as {
    id: string;
    address_line1: string | null;
    postal_code: string | null;
    city: string | null;
  }[];
  return NextResponse.json(
    {
      items: rows.map((r) => ({
        id: r.id,
        addressLine1: r.address_line1,
        postalCode: r.postal_code,
        city: r.city,
      })),
    },
    { headers: NO_STORE },
  );
}
