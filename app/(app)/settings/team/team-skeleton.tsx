import { Card, Skeleton, Stack } from "@yourorg/ui";

/** Shaped Suspense fallback for `TeamBoard` (docs/ARCHITECTURE.md "skeleton
 * loading, not spinners") — same shape as `ReferenceListsSkeleton`: a
 * button-height bar plus a table-shaped placeholder. */
export function TeamSkeleton() {
  return (
    <Stack gap="md" aria-hidden>
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
