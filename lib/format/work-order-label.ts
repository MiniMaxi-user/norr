/**
 * Display label for a work order (issue #218): the system-assigned work order
 * number is the primary identifier, the optional external reference is
 * secondary - "WO2872 · External ref".
 */
export function workOrderLabel(workOrder: {
  work_order_number: string;
  external_reference?: string | null;
}): string {
  return workOrder.external_reference
    ? `${workOrder.work_order_number} · ${workOrder.external_reference}`
    : workOrder.work_order_number;
}
