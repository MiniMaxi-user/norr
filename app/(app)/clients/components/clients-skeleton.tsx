import { Card, Skeleton, Stack } from "@yourorg/ui";

/**
 * Shaped Suspense fallback for the clients list/kanban Server Component
 * (`clients-board.tsx`) — per docs/ARCHITECTURE.md ("skeleton loading, not
 * spinners"), shaped like the eventual controls-bar + table, not a generic
 * placeholder.
 */
export function ClientsSkeleton() {
  return (
    <Stack gap="lg" aria-hidden>
      <Card>
        <Stack gap="sm">
          <Skeleton height="2.25rem" width="100%" />
          <Skeleton height="2rem" width="14rem" />
        </Stack>
      </Card>
      <Card>
        <Stack gap="sm">
          <Skeleton height="1.5rem" width="30%" />
          <Skeleton height="2.5rem" />
          <Skeleton height="2.5rem" />
          <Skeleton height="2.5rem" />
          <Skeleton height="2.5rem" />
          <Skeleton height="2.5rem" />
        </Stack>
      </Card>
    </Stack>
  );
}
