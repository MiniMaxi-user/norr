import { Card, Skeleton, Spinner, Stack } from "@yourorg/ui";

/** Shaped Suspense fallback for the client detail page — mirrors the real
 * layout (client card, then a tab bar, then a table-shaped block) so the
 * skeleton doesn't jump around once real content streams in. The `Spinner`
 * above it (issue #140 follow-up, see `MainSkeleton`'s own doc comment) keeps
 * every shaped skeleton branded, not just the plain-fallback routes. */
export function ClientDetailSkeleton() {
  return (
    <Stack gap="lg" aria-hidden>
      <Spinner size={20} />
      <Skeleton height="1rem" width="8rem" />
      <Card>
        <Stack gap="sm">
          <Skeleton height="2rem" width="40%" />
          <Skeleton height="1rem" width="60%" />
          <Skeleton height="1rem" width="50%" />
          <Skeleton height="1rem" width="70%" />
        </Stack>
      </Card>
      <Stack gap="md">
        <Skeleton height="1.75rem" width="14rem" />
        <Card>
          <Stack gap="sm">
            <Skeleton height="2.5rem" />
            <Skeleton height="2.5rem" />
            <Skeleton height="2.5rem" />
          </Stack>
        </Card>
      </Stack>
    </Stack>
  );
}
