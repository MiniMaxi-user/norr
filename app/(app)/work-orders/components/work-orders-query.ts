import type { ListWorkOrdersOptions } from "../actions";

/** Rows per page of the Work Orders list. */
export const WORK_ORDERS_PAGE_SIZE = 25;

/** Raw `?` params of `/work-orders` (all optional strings). `tab` is the
 * legacy Review/Orders/Completed deep link (issue #207), redirected by
 * `page.tsx` to the equivalent `seg`/`status` params. */
export interface WorkOrdersSearchParams {
  tab?: string;
  page?: string;
  q?: string;
  status?: string;
  priority?: string;
  client?: string;
  assignee?: string;
  seg?: string;
  sort?: string;
  dir?: string;
}

/** URL param names of the list's dropdowns. */
export const WORK_ORDERS_DROPDOWN_IDS = {
  status: "status",
  priority: "priority",
  client: "client",
  assignee: "assignee",
} as const;

/** The 3-value toggle (All last): which part of the lifecycle to show.
 * `open` (the default, not written to the URL) is every status except
 * completed/invoiced — so it includes work orders waiting for review. */
export const WORK_ORDERS_STAGE_SEGMENT = {
  label: "Stage",
  defaultValue: "open",
  options: [
    { value: "open", label: "Open" },
    { value: "done", label: "Done" },
    { value: "all", label: "All" },
  ] as const,
};

export type WorkOrdersStage = "open" | "done" | "all";

export function parseStage(raw: string | undefined): WorkOrdersStage {
  return raw === "done" || raw === "all" ? raw : "open";
}

/** Column id (URL `?sort=`) -> `listWorkOrders` sort column. */
const SORT_BY_COLUMN: Record<string, NonNullable<ListWorkOrdersOptions["sort"]>> = {
  number: "work_order_number",
  scheduled: "scheduled_at",
};

/** Translates the list page's URL params into `listWorkOrders` options. The
 * stage toggle needs the org's status ids (resolved from the
 * `work_order_status` list by fixed value), passed in by the caller. Unknown
 * values are dropped; the server action validates ids again. */
export function parseWorkOrdersQuery(
  params: WorkOrdersSearchParams,
  completedStatusIds: string[],
  searchAssigneeIds: string[] = [],
): { page: number; stage: WorkOrdersStage; options: ListWorkOrdersOptions } {
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const stage = parseStage(params.seg);
  return {
    page,
    stage,
    options: {
      limit: WORK_ORDERS_PAGE_SIZE,
      offset: (page - 1) * WORK_ORDERS_PAGE_SIZE,
      withUnfilteredCount: true,
      search: params.q?.trim() || undefined,
      searchAssigneeIds: searchAssigneeIds.length > 0 ? searchAssigneeIds : undefined,
      statusId: params.status || undefined,
      priorityId: params.priority || undefined,
      clientId: params.client || undefined,
      assignedTo: params.assignee || undefined,
      statusIds: stage === "done" ? completedStatusIds : undefined,
      excludeStatusIds: stage === "open" ? completedStatusIds : undefined,
      sort: params.sort ? SORT_BY_COLUMN[params.sort] : undefined,
      direction: params.dir === "desc" ? "desc" : "asc",
    },
  };
}
