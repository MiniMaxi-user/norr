import { WebCard, WebDataTableEmpty, WebListPage } from "@yourorg/ui/web";
import { listWarehouses } from "../actions";
import { WarehousesTableCard } from "./warehouses-table-card";

/**
 * Async Server Component of `/inventory` (list-page shell, issue #222):
 * fetches the warehouses and renders them in `WebListPage`. Rendered inside
 * `page.tsx`'s `Suspense` (fallback `WebListSkeleton`), so the header streams
 * in before the data.
 *
 * One warehouse per engineer, auto-created: there is no "New warehouse"
 * action in this module, so the header has no primary button. The list is
 * unpaginated (bounded by team size), so the table filters client-side.
 */
export async function WarehousesList() {
  const result = await listWarehouses();

  if (!result.data) {
    return (
      <WebListPage module="Inventory" title="Inventory">
        <WebCard title="Warehouses">
          <WebDataTableEmpty>{result.error ?? "Could not load warehouses."}</WebDataTableEmpty>
        </WebCard>
      </WebListPage>
    );
  }

  const { warehouses } = result.data;

  return (
    <WebListPage module="Inventory" title="Inventory" count={warehouses.length}>
      <WarehousesTableCard warehouses={warehouses} />
    </WebListPage>
  );
}
