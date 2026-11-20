import { NextResponse } from "next/server";
import { createClient as createSupabaseServerClient } from "@/lib/supabase/server";
import { requireModuleContext } from "@/lib/actions/module-context";
import { can } from "@/lib/rbac/permissions";
import { buildInvoiceCsv, type InvoiceCsvRow } from "@/lib/invoicing/invoice-csv";
import { parseInvoicesQuery, type InvoicesSearchParams } from "../components/invoices-query";
import { applyInvoiceFilters, applyInvoiceSort } from "../invoice-filters";

/**
 * GET /invoices/export.csv — bookkeeping CSV (one row per invoice per VAT rate)
 * of ALL invoices matching the list page's filters (same `?` params, no paging)
 * (issue #241). Auth: normal session; `invoicing` feature + `read` permission;
 * everything runs through the RLS-enforced server client.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INVOICES = 10_000;
const ID_PAGE = 1000;
const DETAIL_CHUNK = 100;

const PARAM_KEYS = ["page", "q", "status", "type", "clientId", "period", "seg", "sort", "dir"] as const;

export async function GET(request: Request) {
  // Link prefetches must not run the (heavy) export.
  if (request.headers.get("next-router-prefetch") || request.headers.get("purpose") === "prefetch") {
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  }

  const ctx = await requireModuleContext("invoicing");
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: 403 });
  if (!can(ctx.context.actor, "invoicing", "read")) {
    return NextResponse.json({ error: "You do not have permission to view invoices." }, { status: 403 });
  }

  const search = new URL(request.url).searchParams;
  const params: InvoicesSearchParams = {};
  for (const key of PARAM_KEYS) {
    const value = search.get(key);
    if (value !== null) params[key] = value;
  }
  const { filters, noMatch } = parseInvoicesQuery(params);

  const supabase = await createSupabaseServerClient();

  // 1. Ids in list order (the overview view carries the filter columns, not the VAT breakdown).
  const ids: string[] = [];
  if (!noMatch) {
    for (let offset = 0; offset <= MAX_INVOICES; offset += ID_PAGE) {
      const { data, error } = await applyInvoiceSort(
        applyInvoiceFilters(supabase.from("invoice_overview").select("id"), filters),
        filters,
      ).range(offset, offset + ID_PAGE - 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const chunk = (data ?? []) as { id: string }[];
      ids.push(...chunk.map((row) => row.id));
      if (chunk.length < ID_PAGE) break;
    }
    if (ids.length > MAX_INVOICES) {
      return NextResponse.json(
        { error: `The export is limited to ${MAX_INVOICES} invoices. Narrow the filters (for example the period) and try again.` },
        { status: 413 },
      );
    }
  }

  // 2. Snapshot columns per invoice, in chunks (URL length), re-ordered to the list order.
  const byId = new Map<string, InvoiceCsvRow>();
  for (let i = 0; i < ids.length; i += DETAIL_CHUNK) {
    const { data, error } = await supabase
      .from("invoices")
      .select("id, invoice_number, kind, invoice_date, subtotal, vat_total, vat_breakdown, recipient")
      .in("id", ids.slice(i, i + DETAIL_CHUNK));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const row of (data ?? []) as unknown as (InvoiceCsvRow & { id: string })[]) {
      byId.set(row.id, {
        invoice_number: row.invoice_number,
        kind: row.kind,
        invoice_date: row.invoice_date,
        subtotal: row.subtotal,
        vat_total: row.vat_total,
        vat_breakdown: row.vat_breakdown ?? [],
        recipient: { name: row.recipient?.name ?? "", vat_number: row.recipient?.vat_number ?? null },
      });
    }
  }
  const rows = ids.map((id) => byId.get(id)).filter((row): row is InvoiceCsvRow => row !== undefined);

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(new Date());
  return new NextResponse(buildInvoiceCsv(rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="invoices-${today}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
