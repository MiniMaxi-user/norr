import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { can } from "@/lib/rbac/permissions";
import { renderInvoicePdfForQuote } from "../../invoice-render";

/**
 * GET /quotes/[id]/invoice — renders the quote's invoice PDF on demand
 * (issue #211) and returns it inline. Auth: normal session; `invoicing`
 * feature + `read` permission; all data is read through the RLS-enforced
 * server client. Nothing is stored.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid quote id." }, { status: 400 });
  }

  const ctx = await requireModuleContext("invoicing");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: 403 });
  if (!can(ctx.context.actor, "invoicing", "read")) {
    return NextResponse.json({ error: "You do not have permission to view invoices." }, { status: 403 });
  }

  const supabase = await createSupabaseServerClient();
  const { rendered, error, code } = await renderInvoicePdfForQuote(supabase, id);
  if (!rendered) {
    const status = code === "not_invoiced" || code === "not_found" ? 404 : 500;
    return NextResponse.json({ error }, { status });
  }

  return new NextResponse(new Uint8Array(rendered.pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${rendered.invoiceNumber.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
