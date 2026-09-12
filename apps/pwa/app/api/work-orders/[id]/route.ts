import { NextResponse } from "next/server";
import { canAny } from "@yourorg/rbac";

import { getCurrentEngineerSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type {
  WorkOrderArticleEntry,
  WorkOrderDetail,
  WorkOrderDetailResponse,
  WorkOrderTimeEntry,
} from "@/lib/work-orders/types";

/**
 * GET /api/work-orders/[id] — the work-order-detail read for issue #170
 * (Work/Hours/Articles tabs). Same read pattern as `/api/workitems/today`
 * (resolve session -> `canAny()` -> query under the caller's own RLS-
 * enforced session, no extra app-layer `assigned_to` filter layered on top —
 * `work_orders_select_scoped` already does that at the DB, see that route's
 * own doc comment for the full reasoning) plus two more RLS-scoped reads
 * (`time_entries`, `work_order_articles`) for the Hours/Articles tabs.
 *
 * Per issue #170's explicit scope boundary: this is the REAL, Supabase-
 * backed read half of the story — timer start/stop, new articles, photos,
 * and signatures stay local-only (`lib/offline/db.ts`) and are never posted
 * back here or anywhere else in this story.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ResolvedReferenceRow {
  label: string;
  color: string | null;
}

interface WorkOrderDetailRow {
  id: string;
  title: string;
  description: string | null;
  scheduled_at: string | null;
  work_order_status: ResolvedReferenceRow | null;
  work_order_priority: ResolvedReferenceRow | null;
  client: { id: string; name: string } | null;
  site: {
    id: string;
    address_line1: string | null;
    address_line2: string | null;
    postal_code: string | null;
    city: string | null;
    phone: string | null;
  } | null;
  asset: {
    id: string;
    name: string;
    serial_number: string | null;
    installed_at: string | null;
    asset_brand: { label: string } | null;
    asset_model: { name: string } | null;
  } | null;
  contract: {
    id: string;
    name: string;
    start_date: string;
    end_date: string | null;
    contract_type: { label: string } | null;
  } | null;
}

const WORK_ORDER_DETAIL_SELECT = `
  id, title, description, scheduled_at,
  work_order_status:reference_list_items!work_orders_status_id_fkey(label,color),
  work_order_priority:reference_list_items!work_orders_priority_id_fkey(label,color),
  client:clients(id,name),
  site:sites(id,address_line1,address_line2,postal_code,city,phone),
  asset:assets!work_orders_asset_id_fkey(
    id, name, serial_number, installed_at,
    asset_brand:reference_list_items!assets_brand_item_id_fkey(label),
    asset_model:asset_models!assets_model_id_fkey(name)
  ),
  contract:contracts(
    id, name, start_date, end_date,
    contract_type:reference_list_items!contracts_type_id_fkey(label)
  )
`;

interface TimeEntryRow {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  time_entry_type: { value: string } | null;
}

interface WorkOrderArticleRow {
  id: string;
  article_id: string;
  quantity: number;
  article: { article_number: string; description: string } | null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid work order id." }, { status: 400 });
  }

  const session = await getCurrentEngineerSession();
  if (!session || session.role !== "engineer") {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  if (!canAny({ role: session.role }, "planning", ["read", "read_own"])) {
    return NextResponse.json({ error: "You do not have permission to view work orders." }, { status: 403 });
  }

  const supabase = await createClient();

  const [workOrderResult, timeEntriesResult, articlesResult] = await Promise.all([
    supabase.from("work_orders").select(WORK_ORDER_DETAIL_SELECT).eq("id", id).maybeSingle(),
    supabase
      .from("time_entries")
      .select("id, user_id, started_at, ended_at, time_entry_type:reference_list_items!time_entries_entry_type_id_fkey(value)")
      .eq("work_order_id", id)
      .order("started_at", { ascending: true }),
    supabase
      .from("work_order_articles")
      .select("id, article_id, quantity, article:articles!work_order_articles_article_id_fkey(article_number,description)")
      .eq("work_order_id", id)
      .order("created_at", { ascending: true }),
  ]);

  if (workOrderResult.error) {
    console.error("GET /api/work-orders/[id]: failed to load work order", workOrderResult.error);
    return NextResponse.json({ error: "Failed to load work order." }, { status: 500 });
  }
  const row = workOrderResult.data as unknown as WorkOrderDetailRow | null;
  if (!row) {
    // Either it doesn't exist, or RLS (`work_orders_select_scoped`) hid it
    // because it's not assigned to this engineer — both correctly surface
    // as a plain 404, same as any other not-found record.
    return NextResponse.json({ error: "Work order not found." }, { status: 404 });
  }

  if (timeEntriesResult.error) {
    console.error("GET /api/work-orders/[id]: failed to load time entries", timeEntriesResult.error);
    return NextResponse.json({ error: "Failed to load logged hours." }, { status: 500 });
  }
  if (articlesResult.error) {
    console.error("GET /api/work-orders/[id]: failed to load articles", articlesResult.error);
    return NextResponse.json({ error: "Failed to load consumed articles." }, { status: 500 });
  }

  const workOrder: WorkOrderDetail = {
    id: row.id,
    title: row.title,
    description: row.description,
    scheduledAt: row.scheduled_at,
    status: row.work_order_status ? { label: row.work_order_status.label, color: row.work_order_status.color } : null,
    priority: row.work_order_priority
      ? { label: row.work_order_priority.label, color: row.work_order_priority.color }
      : null,
    client: row.client ? { id: row.client.id, name: row.client.name } : null,
    site: row.site
      ? {
          id: row.site.id,
          addressLine1: row.site.address_line1,
          addressLine2: row.site.address_line2,
          postalCode: row.site.postal_code,
          city: row.site.city,
          phone: row.site.phone,
        }
      : null,
    asset: row.asset
      ? {
          id: row.asset.id,
          name: row.asset.name,
          serialNumber: row.asset.serial_number,
          installedAt: row.asset.installed_at,
          brand: row.asset.asset_brand?.label ?? null,
          model: row.asset.asset_model?.name ?? null,
        }
      : null,
    contract: row.contract
      ? {
          id: row.contract.id,
          name: row.contract.name,
          type: row.contract.contract_type?.label ?? null,
          startDate: row.contract.start_date,
          endDate: row.contract.end_date,
        }
      : null,
  };

  const timeEntryRows = (timeEntriesResult.data ?? []) as unknown as TimeEntryRow[];
  const timeEntries: WorkOrderTimeEntry[] = timeEntryRows.map((entry) => ({
    id: entry.id,
    userId: entry.user_id,
    kind: entry.time_entry_type?.value === "travel" ? "travel" : "work",
    startedAt: entry.started_at,
    endedAt: entry.ended_at,
  }));

  const articleRows = (articlesResult.data ?? []) as unknown as WorkOrderArticleRow[];
  const articles: WorkOrderArticleEntry[] = articleRows.map((entry) => ({
    id: entry.id,
    articleId: entry.article_id,
    articleNumber: entry.article?.article_number ?? "",
    description: entry.article?.description ?? "",
    quantity: entry.quantity,
  }));

  const response: WorkOrderDetailResponse = { workOrder, timeEntries, articles };
  return NextResponse.json(response);
}
