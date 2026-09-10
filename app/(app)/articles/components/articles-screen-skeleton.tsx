import { Card, Skeleton, Spinner, Stack } from "@yourorg/ui";

/**
 * Suspense fallback for `ArticlesScreen`, shaped like the eventual content
 * (docs/ARCHITECTURE.md "skeleton loading, plus the branded Spinner") — a
 * toolbar-height bar plus a table-shaped placeholder, same shape
 * `AssetsScreenSkeleton` uses for its own list view. The `Spinner` above the
 * shimmer (issue #140 follow-up, see `MainSkeleton`'s own doc comment for
 * the full reasoning) keeps every shaped skeleton branded, not just the
 * plain-fallback routes.
 */
export function ArticlesScreenSkeleton() {
  return (
    <Stack gap="md" aria-hidden>
      <Spinner size={20} />
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
