import { Skeleton, Spinner, Stack } from "@yourorg/ui";

/**
 * Default Suspense fallback for the main content slot. Per
 * docs/ARCHITECTURE.md ("skeleton loading, plus the branded Spinner"), every
 * primary view streams in behind a skeleton shaped like its eventual content
 * — this generic one is a placeholder until real module pages define their
 * own shaped skeletons (a list skeleton, a kanban-column skeleton, etc.).
 * The `Spinner` (issue #140 follow-up) sits above the shimmer blocks on
 * every shaped skeleton, not just the ones with no shape of their own — a
 * shaped skeleton alone doesn't read as branded, and the product owner
 * explicitly wants the mark visible everywhere something is loading, not
 * only on the plain-fallback routes.
 */
export function MainSkeleton() {
  return (
    <Stack gap="md" aria-hidden>
      <Spinner size={20} />
      <Skeleton height="2rem" width="40%" />
      <Skeleton height="8rem" />
      <Skeleton height="8rem" />
      <Skeleton height="8rem" />
    </Stack>
  );
}
