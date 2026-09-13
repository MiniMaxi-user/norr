import { Card, Skeleton, Spinner, Stack } from "@yourorg/ui";

/**
 * Suspense fallback for `InventoryScreen` — same shape as
 * `ArticlesScreenSkeleton`/`ContractsScreenSkeleton` (a branded `Spinner`
 * above a table-shaped shimmer), no toolbar bar since the Voorraad overview
 * has no filter bar of its own.
 */
export function InventoryScreenSkeleton() {
  return (
    <Stack gap="md" aria-hidden>
      <Spinner size={20} />
      <Card>
        <Stack gap="sm">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} height="2.5rem" />
          ))}
        </Stack>
      </Card>
    </Stack>
  );
}
