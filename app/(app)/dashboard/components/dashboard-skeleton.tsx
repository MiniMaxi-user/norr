import { Card, Grid, OverviewHeroBand, Skeleton, Stack } from "@yourorg/ui";

/**
 * Suspense fallback for `DashboardScreen` (and the pre-hydration state of
 * `DashboardView`), shaped like the real dashboard so nothing jumps on load:
 * the hero band with its KPI strip, then the four chart rows.
 */
export function DashboardSkeleton() {
  return (
    <Stack gap="md" aria-hidden>
      <OverviewHeroBand compact title="Dashboard" actions={<Skeleton height="2rem" width="16rem" />}>
        <Skeleton height="4.5rem" width="100%" />
      </OverviewHeroBand>
      <Grid columns="2-1">
        <Card>
          <Skeleton height="19rem" />
        </Card>
        <Card>
          <Skeleton height="19rem" />
        </Card>
      </Grid>
      <Grid columns="2-1-1">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index}>
            <Skeleton height="13rem" />
          </Card>
        ))}
      </Grid>
      <Grid columns={3}>
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index}>
            <Skeleton height="12rem" />
          </Card>
        ))}
      </Grid>
      <Grid columns="2-1">
        <Card>
          <Skeleton height="14rem" />
        </Card>
        <Card>
          <Skeleton height="14rem" />
        </Card>
      </Grid>
    </Stack>
  );
}
