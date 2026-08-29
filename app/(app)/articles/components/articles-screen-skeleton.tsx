import { Card, Skeleton, Stack } from "@yourorg/ui";

/**
 * Suspense fallback for `ArticlesScreen`, shaped like the eventual content
 * (docs/ARCHITECTURE.md "skeleton loading, not spinners") — a toolbar-height
 * bar plus a table-shaped placeholder, same shape `AssetsScreenSkeleton`
 * uses for its own list view.
 */
export function ArticlesScreenSkeleton() {
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
