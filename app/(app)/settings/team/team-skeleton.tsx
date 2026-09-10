import { Card, Skeleton, Spinner, Stack } from "@yourorg/ui";

/** Shaped Suspense fallback for `TeamBoard` (docs/ARCHITECTURE.md "skeleton
 * loading, plus the branded Spinner") — same shape as `ReferenceListsSkeleton`:
 * a button-height bar plus a table-shaped placeholder. The `Spinner` above it
 * (issue #140 follow-up, see `MainSkeleton`'s own doc comment) keeps every
 * shaped skeleton branded, not just the plain-fallback routes. */
export function TeamSkeleton() {
  return (
    <Stack gap="md" aria-hidden>
      <Spinner size={20} />
      <Skeleton height="2rem" width="12rem" />
      <Card>
        <Stack gap="sm">
          <Skeleton height="1.5rem" width="30%" />
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} height="2.5rem" />
          ))}
        </Stack>
      </Card>
    </Stack>
  );
}
