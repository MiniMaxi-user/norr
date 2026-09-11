import { Card, Skeleton, Spinner, Stack } from "@yourorg/ui";
import type { PlanningView } from "../types";

/**
 * Suspense fallback for `PlanningBoard` (docs/ARCHITECTURE.md "skeletons +
 * Suspense streaming, never bare spinners on primary views") — shaped like
 * the eventual dark topbar + backlog/grid two-column layout, so the page
 * never flashes a blank/spinner-only state while its several `await`s
 * resolve.
 */
export function PlanningBoardSkeleton({ view }: { view: PlanningView }) {
  return (
    <Stack gap="md" aria-hidden>
      <Skeleton height="4rem" width="100%" />
      <Spinner size={20} />
      <div className="ui-planning-layout">
        <Card>
          <Stack gap="sm">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} height="4rem" />
            ))}
          </Stack>
        </Card>
        <Stack gap="md">
          {Array.from({ length: 2 }).map((_, index) => (
            <Card key={index}>
              <Stack gap="sm">
                <Skeleton height="1.5rem" width="40%" />
                <Skeleton height={view === "week" ? "6rem" : "3rem"} />
                <Skeleton height={view === "week" ? "6rem" : "3rem"} />
              </Stack>
            </Card>
          ))}
        </Stack>
      </div>
    </Stack>
  );
}
