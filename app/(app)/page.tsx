import { Suspense } from "react";
import { Card, Heading, Text, Stack } from "@yourorg/ui";
import { MainSkeleton } from "@/components/shell/main-skeleton";

// Placeholder home/dashboard content — real widgets land in Phase 3
// (docs/ROADMAP.md "Dashboarding"). This route exists purely so the app
// shell (issue #5) has something to wrap; do not build on top of it
// without checking the roadmap phase first.
export default function DashboardPage() {
  return (
    <Stack gap="lg">
      <Heading level={1}>Welcome to Norr</Heading>
      <Text tone="muted">
        The app shell is in place. Module content (Clients, Assets,
        Contracts, Planning, Reporting, Facturatie) ships in later phases —
        see docs/ROADMAP.md.
      </Text>

      {/* Demonstrates the required streaming pattern (skeleton, not a
          spinner) for a nested async Server Component — the pattern every
          real module view should follow once it fetches data. */}
      <Suspense fallback={<MainSkeleton />}>
        <WelcomePanel />
      </Suspense>
    </Stack>
  );
}

async function WelcomePanel() {
  // No real data source yet (Phase 0). Standing in for a future
  // `await` (Supabase query, hasFeature() check, etc.) so this route
  // exercises the same Suspense boundary real module pages will use.
  return (
    <Card>
      <Heading level={2}>Scaffold status</Heading>
      <Text tone="muted">
        Nav, command palette (Ctrl/Cmd+K), and theming are wired through
        `@yourorg/ui`. Sign-in state is not yet checked here — see the TODO
        in `app/(app)/layout.tsx`.
      </Text>
    </Card>
  );
}
