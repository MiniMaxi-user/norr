import { Card, Skeleton, Stack } from "@yourorg/ui";

/**
 * Suspense fallback for `WorkOrdersScreen`, shaped like the eventual content
 * (docs/ARCHITECTURE.md "skeleton loading, not spinners") — a toolbar-height
 * bar plus a table-shaped placeholder. No view-switcher shape to account for
 * (this task's explicit scope is a plain list — no kanban/calendar/map, see
 * the future Planning/Dispatch board in docs/ROADMAP.md), unlike
 * `AssetsScreenSkeleton`.
 */
export function WorkOrdersScreenSkeleton() {
  return (
    <Stack gap="md" aria-hidden>
      <Skeleton height="2.5rem" width="100%" />
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
