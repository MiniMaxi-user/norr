import { NextResponse } from "next/server";
import { can } from "@yourorg/rbac";
import { z } from "zod";

import { getCurrentEngineerSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/work-orders — an engineer creates a work order on site (issue
 * #223). ONLINE ONLY. Engineers have no INSERT policy on `work_orders`, so the
 * only path is the SECURITY DEFINER `create_field_work_order` RPC (called under
 * the caller's own session; it re-checks membership/role and validates
 * site->client, asset->site and the type allow-list).
 *
 * Note: the PWA has no `hasFeature()` helper; entitlement is enforced by the
 * web app, and the RPC checks org membership + role.
 */

const NO_STORE = { "Cache-Control": "no-store" };

const bodySchema = z.object({
  clientId: z.string().uuid(),
  siteId: z.string().uuid(),
  assetId: z.string().uuid(),
  typeId: z.string().uuid(),
  description: z.string().trim().min(1, "Description is required.").max(2000, "Description is too long."),
  assignToSelf: z.boolean().default(false),
});

export async function POST(request: Request) {
  const session = await getCurrentEngineerSession();
  if (!session || session.role !== "engineer") {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401, headers: NO_STORE });
  }
  if (!can({ role: session.role }, "planning", "create_own") || !can({ role: session.role }, "activities", "create_own")) {
    return NextResponse.json({ error: "You do not have permission to create work orders." }, { status: 403, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400, headers: NO_STORE });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please fix the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400, headers: NO_STORE },
    );
  }
  const input = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_field_work_order", {
    p_client_id: input.clientId,
    p_site_id: input.siteId,
    p_asset_id: input.assetId,
    p_type_id: input.typeId,
    p_description: input.description,
    p_assign_to_self: input.assignToSelf,
  });

  if (error) {
    if (error.code === "22023") return NextResponse.json({ error: error.message }, { status: 400, headers: NO_STORE });
    if (error.code === "42501") return NextResponse.json({ error: error.message }, { status: 403, headers: NO_STORE });
    console.error("POST /api/work-orders: create_field_work_order failed", error);
    return NextResponse.json({ error: "Failed to create the work order." }, { status: 500, headers: NO_STORE });
  }

  const row = (Array.isArray(data) ? data[0] : data) as { work_order_id: string; work_order_number: string } | null;
  if (!row) {
    console.error("POST /api/work-orders: RPC returned no row");
    return NextResponse.json({ error: "Failed to create the work order." }, { status: 500, headers: NO_STORE });
  }

  return NextResponse.json(
    { workOrderId: row.work_order_id, workOrderNumber: row.work_order_number, assignedToSelf: input.assignToSelf },
    { status: 201, headers: NO_STORE },
  );
}
