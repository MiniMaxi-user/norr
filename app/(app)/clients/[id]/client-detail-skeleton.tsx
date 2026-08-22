import { Card, Skeleton, Stack } from "@yourorg/ui";

/** Shaped Suspense fallback for the client detail page. */
export function ClientDetailSkeleton() {
  return (
    <Stack gap="lg" aria-hidden>
      <Skeleton height="1rem" width="8rem" />
      <Card>
        <Stack gap="sm">
          <Skeleton height="2rem" width="40%" />
          <Skeleton height="1rem" width="60%" />
          <Skeleton height="1rem" width="50%" />
          <Skeleton height="1rem" width="70%" />
        </Stack>
      </Card>
      <Card>
        <Stack gap="sm">
          <Skeleton height="1.5rem" width="20%" />
          <Skeleton height="2.5rem" />
          <Skeleton height="2.5rem" />
        </Stack>
      </Card>
    </Stack>
  );
}
