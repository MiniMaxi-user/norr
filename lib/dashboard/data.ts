import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { CurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAny, type PermissionActor } from "@/lib/rbac/permissions";
import { memberDisplayName } from "@/lib/members/format";
import type {
  DashboardActivity,
  DashboardDataset,
  DashboardQuote,
  DashboardQuoteLine,
  DashboardWorkOrder,
} from "./types";

/**
 * Dashboard data layer. Everything runs under the caller's own RLS-scoped
 * client (never the admin client), in parallel, and is bounded: the last 24
 * calendar months (12 months shown + 12 for the "vs previous period" deltas)
 * plus every still-open item regardless of age. Each section is skipped
 * entirely when the user lacks the module/feature, so no data the user could
 * not otherwise open ever reaches the client.
 */

const PAGE_SIZE = 1000;
const MAX_ROWS_PER_QUERY = 6000;
const HISTORY_MONTHS = 24;

type RefItem = { value: string; label: string; color: string | null } | null;
type Embedded<T> = T | T[] | null;

function one<T>(value: Embedded<T> | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

interface PageResult {
  data: unknown[] | null;
  error: { message: string } | null;
}

/** Pages through a PostgREST query (1000-row server cap) up to `MAX_ROWS_PER_QUERY`. */
async function fetchPaged<T>(
  build: (range: { from: number; to: number }) => PromiseLike<PageResult>,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS_PER_QUERY; from += PAGE_SIZE) {
    const { data, error } = await build({ from, to: from + PAGE_SIZE - 1 });
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

const WORK_ORDER_COLUMNS =
  "id, title, client_id, asset_id, assigned_to, created_at, scheduled_at, completed_at, duration_minutes";
const WORK_ORDER_EMBEDS =
  "type:reference_list_items!work_orders_type_id_fkey(value,label,color), asset:assets!work_orders_asset_id_fkey(id,name)";

interface WorkOrderRow {
  id: string;
  title: string;
  client_id: string | null;
  asset_id: string | null;
  assigned_to: string | null;
  created_at: string;
  scheduled_at: string | null;
  completed_at: string | null;
  duration_minutes: number | null;
  status: Embedded<NonNullable<RefItem>>;
  type: Embedded<NonNullable<RefItem>>;
  asset: Embedded<{ id: string; name: string }>;
}

interface ActivityRow {
  id: string;
  description: string | null;
  client_id: string | null;
  asset_id: string | null;
  reported_at: string;
  type: Embedded<NonNullable<RefItem>>;
  status: Embedded<NonNullable<RefItem>>;
  asset: Embedded<{ id: string; name: string; asset_model: Embedded<{ name: string }> }>;
}

interface QuoteLineRow {
  article_id: string | null;
  description: string | null;
  quantity: number | string;
  unit_price: number | string;
  discount_percent: number | string;
  purchase_price: number | string | null;
}

interface QuoteRow {
  id: string;
  quote_type: "default" | "contract" | null;
  is_auto_draft: boolean | null;
  client_id: string | null;
  created_at: string;
  updated_at: string;
  status: Embedded<{ value: string }>;
  invoice?: Embedded<{ invoice_number: string | null; generated_at: string | null }>;
  quote_line_items: QuoteLineRow[] | null;
}

function toWorkOrder(
  row: WorkOrderRow,
  clients: Map<string, string>,
  engineers: Map<string, string>,
): DashboardWorkOrder {
  const status = one(row.status);
  const type = one(row.type);
  const asset = one(row.asset);
  const statusValue = status?.value ?? "new";
  const isDone = statusValue === "completed" || statusValue === "invoiced";
  const isOpen = !isDone && statusValue !== "to_review";
  return {
    id: row.id,
    title: row.title,
    clientId: row.client_id,
    clientName: (row.client_id && clients.get(row.client_id)) || "Unknown client",
    assetId: row.asset_id,
    assetName: asset?.name ?? null,
    engineerId: row.assigned_to,
    engineerName: row.assigned_to ? (engineers.get(row.assigned_to) ?? "Unknown") : "Unassigned",
    statusValue,
    statusLabel: status?.label ?? statusValue,
    statusColor: status?.color ?? null,
    typeValue: type?.value ?? null,
    typeLabel: type?.label ?? "No type",
    typeColor: type?.color ?? null,
    createdAt: row.created_at,
    scheduledAt: row.scheduled_at,
    doneAt: isDone ? (row.completed_at ?? row.scheduled_at ?? row.created_at) : null,
    durationMinutes: row.duration_minutes,
    isOpen,
    isDone,
  };
}

function toActivity(row: ActivityRow, clients: Map<string, string>): DashboardActivity {
  const type = one(row.type);
  const status = one(row.status);
  const asset = one(row.asset);
  const statusValue = status?.value ?? "open";
  const summary = (row.description ?? "").trim().split("\n")[0] ?? "";
  return {
    id: row.id,
    typeValue: type?.value ?? "other",
    typeLabel: type?.label ?? "Other",
    typeColor: type?.color ?? null,
    statusValue,
    statusLabel: status?.label ?? statusValue,
    isOpen: statusValue !== "completed",
    clientId: row.client_id,
    clientName: (row.client_id && clients.get(row.client_id)) || "Unknown client",
    assetId: row.asset_id,
    assetName: asset?.name ?? null,
    assetModel: one(asset?.asset_model)?.name ?? null,
    reportedAt: row.reported_at,
    summary: summary.length > 90 ? `${summary.slice(0, 89)}…` : summary,
  };
}

function toQuote(row: QuoteRow, clients: Map<string, string>): DashboardQuote {
  const status = one(row.status)?.value === "invoiced" ? "invoiced" : "draft";
  const invoice = one(row.invoice);
  let total = 0;
  let costedTotal = 0;
  let cost = 0;
  const lines = new Map<string, DashboardQuoteLine>();
  for (const line of row.quote_line_items ?? []) {
    const quantity = Number(line.quantity);
    const lineTotal = quantity * Number(line.unit_price) * (1 - Number(line.discount_percent) / 100);
    total += lineTotal;
    if (line.purchase_price !== null && line.purchase_price !== undefined) {
      costedTotal += lineTotal;
      cost += quantity * Number(line.purchase_price);
    }
    if (status === "invoiced") {
      const name = (line.description ?? "").trim() || "Untitled line";
      const key = line.article_id ?? name.toLowerCase();
      const existing = lines.get(key);
      if (existing) {
        existing.quantity += quantity;
        existing.revenue += lineTotal;
      } else {
        lines.set(key, { key, name, quantity, revenue: lineTotal });
      }
    }
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    id: row.id,
    status,
    quoteType: row.quote_type === "contract" ? "contract" : "default",
    isAutoDraft: Boolean(row.is_auto_draft),
    clientId: row.client_id,
    clientName: (row.client_id && clients.get(row.client_id)) || "Unknown client",
    date: status === "invoiced" ? (invoice?.generated_at ?? row.updated_at) : row.created_at,
    total: round(total),
    costedTotal: round(costedTotal),
    cost: round(cost),
    invoiceNumber: invoice?.invoice_number ?? null,
    lines: [...lines.values()].map((line) => ({ ...line, quantity: round(line.quantity), revenue: round(line.revenue) })),
  };
}

export async function getDashboardDataset(
  session: CurrentSession,
  actor: PermissionActor,
): Promise<DashboardDataset> {
  const organization = session.organization;
  const empty = (now: Date): DashboardDataset => ({
    now: now.toISOString(),
    windowStart: now.toISOString(),
    visible: { workOrders: false, activities: false, finance: false },
    truncated: false,
    workOrders: [],
    activities: [],
    quotes: [],
  });
  const now = new Date();
  if (!organization) return empty(now);

  const [planningOn, activitiesOn, quotesOn] = await Promise.all([
    hasFeature(organization, "planning"),
    hasFeature(organization, "activities"),
    hasFeature(organization, "quotes"),
  ]);
  const visible = {
    workOrders: planningOn && canAny(actor, "planning", ["read", "read_own"]),
    activities: activitiesOn && canAny(actor, "activities", ["read", "read_own"]),
    // Company-wide revenue is management-level: quotes read plus either the
    // right to create quotes (owner/planner) or to read billing (owner/finance/
    // administratie). Engineers can read quotes by RLS, but not see revenue here.
    finance: quotesOn && can(actor, "quotes", "read") && (can(actor, "quotes", "create") || can(actor, "billing", "read")),
  };
  if (!visible.workOrders && !visible.activities && !visible.finance) return empty(now);

  const windowStart = new Date(now.getFullYear(), now.getMonth() - (HISTORY_MONTHS - 1), 1);
  const since = windowStart.toISOString();
  const supabase = await createClient();
  let truncated = false;

  const clientsPromise = fetchPaged<{ id: string; name: string }>(({ from, to }) =>
    supabase.from("clients").select("id, name").order("id").range(from, to),
  ).then((result) => new Map(result.rows.map((row) => [row.id, row.name])));

  const engineersPromise = visible.workOrders
    ? supabase
        .from("memberships")
        .select("user:users(id, email, full_name)")
        .then(({ data }) => {
          const map = new Map<string, string>();
          for (const row of (data ?? []) as unknown as Array<{
            user: Embedded<{ id: string; email: string; full_name: string | null }>;
          }>) {
            const user = one(row.user);
            if (user) map.set(user.id, memberDisplayName(user));
          }
          return map;
        })
    : Promise.resolve(new Map<string, string>());

  const workOrdersPromise = visible.workOrders
    ? Promise.all([
        fetchPaged<WorkOrderRow>(({ from, to }) =>
          supabase
            .from("work_orders")
            .select(
              `${WORK_ORDER_COLUMNS}, status:reference_list_items!work_orders_status_id_fkey(value,label,color), ${WORK_ORDER_EMBEDS}`,
            )
            .gte("created_at", since)
            .order("created_at", { ascending: false })
            .order("id")
            .range(from, to),
        ),
        // Every open order older than the window (backlog that never closed).
        fetchPaged<WorkOrderRow>(({ from, to }) =>
          supabase
            .from("work_orders")
            .select(
              `${WORK_ORDER_COLUMNS}, status:reference_list_items!work_orders_status_id_fkey!inner(value,label,color), ${WORK_ORDER_EMBEDS}`,
            )
            .lt("created_at", since)
            .not("status.value", "in", "(completed,invoiced)")
            .order("created_at", { ascending: false })
            .order("id")
            .range(from, to),
        ),
      ])
    : null;

  const activitiesPromise = visible.activities
    ? Promise.all([
        fetchPaged<ActivityRow>(({ from, to }) =>
          supabase
            .from("activities")
            .select(ACTIVITY_SELECT)
            .gte("reported_at", since)
            .order("reported_at", { ascending: false })
            .order("id")
            .range(from, to),
        ),
        fetchPaged<ActivityRow>(({ from, to }) =>
          supabase
            .from("activities")
            .select(ACTIVITY_SELECT.replace("activities_status_id_fkey(", "activities_status_id_fkey!inner("))
            .lt("reported_at", since)
            .neq("status.value", "completed")
            .order("reported_at", { ascending: false })
            .order("id")
            .range(from, to),
        ),
      ])
    : null;

  const quotesPromise = visible.finance ? fetchQuotes(supabase, since) : null;

  const [clients, engineers, workOrderPages, activityPages, quoteResult] = await Promise.all([
    clientsPromise.catch(() => new Map<string, string>()),
    Promise.resolve(engineersPromise).catch(() => new Map<string, string>()),
    workOrdersPromise?.catch(logFailure) ?? null,
    activitiesPromise?.catch(logFailure) ?? null,
    quotesPromise?.catch(logFailure) ?? null,
  ]);

  const workOrders: DashboardWorkOrder[] = [];
  if (workOrderPages) {
    const seen = new Set<string>();
    for (const page of workOrderPages) {
      truncated ||= page.truncated;
      for (const row of page.rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        workOrders.push(toWorkOrder(row, clients, engineers));
      }
    }
  }

  const activities: DashboardActivity[] = [];
  if (activityPages) {
    const seen = new Set<string>();
    for (const page of activityPages) {
      truncated ||= page.truncated;
      for (const row of page.rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        activities.push(toActivity(row, clients));
      }
    }
  }

  const quotes: DashboardQuote[] = [];
  if (quoteResult) {
    truncated ||= quoteResult.truncated;
    for (const row of quoteResult.rows) quotes.push(toQuote(row, clients));
  }

  return {
    now: now.toISOString(),
    windowStart: since,
    visible: {
      workOrders: visible.workOrders && workOrderPages !== null,
      activities: visible.activities && activityPages !== null,
      finance: visible.finance && quoteResult !== null,
    },
    truncated,
    workOrders,
    activities,
    quotes,
  };
}

const ACTIVITY_SELECT =
  "id, description, client_id, asset_id, reported_at, type:reference_list_items!activities_type_id_fkey(value,label,color), status:reference_list_items!activities_status_id_fkey(value,label,color), asset:assets(id,name,asset_model:asset_models!assets_model_id_fkey(name))";

const QUOTE_LINES = "quote_line_items(article_id,description,quantity,unit_price,discount_percent,purchase_price)";
const QUOTE_COLUMNS = "id, quote_type, is_auto_draft, client_id, created_at, updated_at";

/** Invoiced quotes in the window plus every draft. The `invoices` embed is
 * RLS-limited to owner/administratie; when it is unreadable (or the embed
 * fails) revenue is dated by the quote's `updated_at` instead. */
async function fetchQuotes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  since: string,
): Promise<{ rows: QuoteRow[]; truncated: boolean }> {
  const build = (withInvoice: boolean) => {
    const invoiceEmbed = withInvoice ? ", invoice:invoices(invoice_number,generated_at)" : "";
    return Promise.all([
      fetchPaged<QuoteRow>(({ from, to }) =>
        supabase
          .from("quotes")
          .select(
            `${QUOTE_COLUMNS}, status:reference_list_items!quotes_status_id_fkey!inner(value)${invoiceEmbed}, ${QUOTE_LINES}`,
          )
          .eq("status.value", "invoiced")
          .gte("updated_at", since)
          .order("updated_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
      fetchPaged<QuoteRow>(({ from, to }) =>
        supabase
          .from("quotes")
          .select(`${QUOTE_COLUMNS}, status:reference_list_items!quotes_status_id_fkey!inner(value), ${QUOTE_LINES}`)
          .eq("status.value", "draft")
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      ),
    ]);
  };
  let pages: Awaited<ReturnType<typeof build>>;
  try {
    pages = await build(true);
  } catch {
    pages = await build(false);
  }
  return {
    rows: pages.flatMap((page) => page.rows),
    truncated: pages.some((page) => page.truncated),
  };
}

function logFailure(error: unknown): null {
  console.error("[dashboard] section failed to load", error);
  return null;
}
