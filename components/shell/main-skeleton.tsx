import { Skeleton, Stack } from "@yourorg/ui";

/**
 * Default Suspense fallback for the main content slot. Per
 * docs/ARCHITECTURE.md ("skeleton loading, not spinners"), every primary
 * view streams in behind a skeleton shaped like its eventual content —
 * this generic one is a placeholder until real module pages define their
 * own shaped skeletons (a list skeleton, a kanban-column skeleton, etc.).
 */
export function MainSkeleton() {
  return (
    <Stack gap="md" aria-hidden>
      <Skeleton height="2rem" width="40%" />
      <Skeleton height="8rem" />
      <Skeleton height="8rem" />
      <Skeleton height="8rem" />
    </Stack>
  );
}
