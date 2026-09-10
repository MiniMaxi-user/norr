import { Card, Skeleton, Spinner, Stack } from "@yourorg/ui";
import type { AssetsView } from "./assets-view-switcher";

/**
 * Suspense fallback for `AssetsScreen`, shaped like the eventual content
 * (docs/ARCHITECTURE.md "skeleton loading, plus the branded Spinner") — a
 * toolbar-height bar plus either a table-shaped or a map-shaped placeholder,
 * depending on which view is about to render. The `Spinner` above the
 * shimmer (issue #140 follow-up, see `MainSkeleton`'s own doc comment) keeps
 * every shaped skeleton branded, not just the plain-fallback routes.
 */
export function AssetsScreenSkeleton({ view }: { view: AssetsView }) {
  return (
    <Stack gap="md" aria-hidden>
      <Spinner size={20} />
      <Skeleton height="2.5rem" width="100%" />
      {view === "map" ? (
        <Skeleton height="480px" />
      ) : (
        <Card>
          <Stack gap="sm">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} height="2.5rem" />
            ))}
          </Stack>
        </Card>
      )}
    </Stack>
  );
}
