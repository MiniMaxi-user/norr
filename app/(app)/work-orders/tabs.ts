/** The Work Orders overview's tabs (issue #207), in display order. */
export const WORK_ORDERS_TABS = ["review", "orders", "completed"] as const;

export type WorkOrdersTab = (typeof WORK_ORDERS_TABS)[number];

export const DEFAULT_WORK_ORDERS_TAB: WorkOrdersTab = "review";

export function parseWorkOrdersTab(raw: string | undefined): WorkOrdersTab {
  return WORK_ORDERS_TABS.find((tab) => tab === raw) ?? DEFAULT_WORK_ORDERS_TAB;
}

/** `work_order_status` item values (tenant-configurable list, fixed slugs)
 * that belong to the Review and Completed tabs; the Orders tab is every
 * other status. */
export const REVIEW_STATUS_VALUES = ["to_review"] as const;
export const COMPLETED_STATUS_VALUES = ["completed", "invoiced"] as const;
