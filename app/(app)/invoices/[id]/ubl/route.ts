import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { can } from "@/lib/rbac/permissions";
import { getInvoiceUbl } from "../../invoice-ubl";

/**
 * GET /invoices/[id]/ubl — downloads the UBL 2.1 (SI-UBL 2.0 / NLCIUS) e-invoice
 * of one invoice or credit note (issue #241). Auth: normal session; `invoicing`
 * feature + `read` permission; all access goes through the RLS-enforced server
 * client. Missing required fields: 422 `{ error: "missing_fields", missing }`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid invoice id." }, { status: 400 });
  }

  const ctx = await requireModuleContext("invoicing");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: 403 });
  if (!can(ctx.context.actor, "invoicing", "read")) {
    return NextResponse.json({ error: "You do not have permission to view invoices." }, { status: 403 });
  }

  const supabase = await createSupabaseServerClient();
  const result = await getInvoiceUbl(supabase, id);
  if (!result.ok) {
    if (result.code === "missing_fields") {
      return NextResponse.json({ error: "missing_fields", missing: result.missing }, { status: 422 });
    }
    return NextResponse.json({ error: result.error }, { status: result.code === "not_found" ? 404 : 500 });
  }

  return new NextResponse(result.xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
