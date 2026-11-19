import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { can } from "@/lib/rbac/permissions";
import { getInvoicePdfById } from "../../../quotes/invoice-render";

/**
 * GET /invoices/[id]/pdf — returns the PDF of one invoice or credit note
 * inline: the stored file, or rendered once from the snapshot, stored, then
 * returned (issues #227, #236). Auth: normal session; `invoicing` feature +
 * `read` permission; all data and storage access goes through the
 * RLS-enforced server client.
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
  const { result, error, code } = await getInvoicePdfById(supabase, id);
  if (!result) {
    const status = code === "not_found" || code === "not_invoiced" ? 404 : 500;
    return NextResponse.json({ error }, { status });
  }

  return new NextResponse(new Uint8Array(result.pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${result.invoiceNumber.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
