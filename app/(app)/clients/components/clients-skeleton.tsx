import { Card, Skeleton, Spinner, Stack } from "@yourorg/ui";

/**
 * Shaped Suspense fallback for the clients list/kanban Server Component
 * (`clients-board.tsx`) — per docs/ARCHITECTURE.md ("skeleton loading, plus
 * the branded Spinner"), shaped like the eventual controls-bar + table, not
 * a generic placeholder. The `Spinner` above it (issue #140 follow-up, see
 * `MainSkeleton`'s own doc comment) keeps every shaped skeleton branded, not
 * just the plain-fallback routes.
 */
export function ClientsSkeleton() {
  return (
    <Stack gap="lg" aria-hidden>
      <Spinner size={20} />
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
