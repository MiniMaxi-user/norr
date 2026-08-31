import { Card, Skeleton, Stack } from "@yourorg/ui";

/**
 * Shaped `Suspense` fallback for a settings leaf's data-fetching board
 * (docs/ARCHITECTURE.md "skeleton loading, not spinners") — same visual
 * shape as `reference-lists/reference-lists-skeleton.tsx`/
 * `checklist-templates/checklist-templates-skeleton.tsx`/`team/team-skeleton.tsx`,
 * parameterized by row count instead of hardcoded per-leaf, so every settings
 * leaf route (issue #110, Settings admin shell) can share one skeleton
 * instead of each declaring its own near-identical file.
 */
export function SettingsSectionSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Stack gap="md" aria-hidden>
      <Skeleton height="2rem" width="16rem" />
      <Card>
        <Stack gap="sm">
          <Skeleton height="1.5rem" width="30%" />
          {Array.from({ length: rows }).map((_, index) => (
            <Skeleton key={index} height="2.5rem" />
          ))}
        </Stack>
      </Card>
    </Stack>
  );
}
