import { Boxes } from "@yourorg/ui/icons";
import { Card, EmptyState, Text } from "@yourorg/ui";
import { listWarehouses } from "../actions";
import { WarehousesTable } from "./warehouses-table";

/**
 * The data-fetching heart of the Voorraad overview — rendered inside a
 * `Suspense` boundary by `app/(app)/inventory/page.tsx` so its shaped
 * skeleton shows while `listWarehouses` resolves (route-level streaming, per
 * docs/ARCHITECTURE.md), same shape `ArticlesScreen` uses.
 *
 * One warehouse per engineer, auto-created — there is no "Create warehouse"
 * action anywhere in this module (see `./actions.ts`'s own header), so the
 * empty state here only ever shows for a brand-new org with no engineers
 * onboarded yet, and offers no create affordance of its own.
 */
export async function InventoryScreen() {
  const result = await listWarehouses();

  if (!result.data) {
    return (
      <Card>
        <Text tone="danger">{result.error ?? "Could not load warehouses."}</Text>
      </Card>
    );
  }

  const { warehouses } = result.data;

  if (warehouses.length === 0) {
    return (
      <EmptyState
        icon={<Boxes />}
        heading="No warehouses yet"
        text="Every engineer gets their own warehouse automatically once they join your organization."
      />
    );
  }

  return <WarehousesTable warehouses={warehouses} />;
}
