import type { WorkOrderRecord } from "../work-orders/actions";

/** One-line title of a work order on the Planning page. Work orders have no
 * title column (issue #218): the optional external reference is the closest
 * thing, then the first line of the description. */
export function workOrderTitle(workOrder: Pick<WorkOrderRecord, "external_reference" | "description">): string {
  const reference = workOrder.external_reference?.trim();
  if (reference) return reference;
  const firstLine = workOrder.description?.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim();
  return firstLine ?? "No description";
}
