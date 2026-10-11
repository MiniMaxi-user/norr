import { Card, Grid, Skeleton, Spinner, Stack } from "@yourorg/ui";

/**
 * Suspense fallback for `DashboardScreen` (and the pre-hydration state of
 * `DashboardView`), shaped like the real dashboard: period switcher, KPI
 * tiles, then chart cards in the same grid arrangement.
 */
export function DashboardSkeleton() {
  return (
    <Stack gap="lg" aria-hidden>
      <Spinner size={20} />
      <Skeleton height="2rem" width="22rem" />
      <Grid columns={4}>
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index}>
            <Stack gap="sm">
              <Skeleton height="0.875rem" width="55%" />
              <Skeleton height="2rem" width="70%" />
              <Skeleton height="0.75rem" width="45%" />
            </Stack>
          </Card>
        ))}
      </Grid>
      <Grid columns="2-1">
        <Card>
          <Skeleton height="16rem" />
        </Card>
        <Card>
          <Stack gap="sm">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} height="2.25rem" />
            ))}
          </Stack>
        </Card>
      </Grid>
      <Grid columns="2-1">
        <Card>
          <Skeleton height="16rem" />
        </Card>
        <Card>
          <Skeleton height="16rem" />
        </Card>
      </Grid>
      <Grid columns={3}>
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index}>
            <Skeleton height="12rem" />
          </Card>
        ))}
      </Grid>
    </Stack>
  );
}
