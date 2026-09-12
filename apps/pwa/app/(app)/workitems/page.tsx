import { Heading, Stack, Text } from "@yourorg/ui";
import { getCurrentEngineerSession } from "@/lib/auth/session";
import { WorkItemsList } from "./work-items-list";

/**
 * Today's-work-orders overview for the logged-in engineer (issue #169).
 * Stays a thin Server Component — `requireEngineerSession()` in
 * `app/(app)/layout.tsx` is still the server-side gate for the online case
 * — but the actual list (fetch + IndexedDB fallback + pull-to-refresh) has
 * to be a client component (`WorkItemsList`), since it must keep rendering
 * with zero network after a prior successful sync.
 *
 * Reads the session again here (already resolved once by the layout's
 * `requireEngineerSession()` — `getCurrentEngineerSession()` is
 * `cache()`-wrapped per request, so this is a free re-read, not a second
 * round-trip) purely to hand `userId` down to `WorkItemsList`: the
 * client-side IndexedDB cache is scoped per-user (see `lib/offline/db.ts`)
 * so a later engineer on the same device never reads an earlier one's
 * cached work orders.
 */
export default async function WorkItemsPage() {
  const session = await getCurrentEngineerSession();
  // The layout above already redirects to /login when there's no valid
  // engineer session — this is only reachable with one. If it's ever null
  // here regardless (shouldn't happen), there's no safe userId to scope the
  // offline cache to, so render nothing rather than fall back to an
  // unscoped (leak-prone) cache read.
  if (!session) return null;

  return (
    <Stack gap="md">
      <Stack gap="xs">
        <Heading level={1}>Werkorders van vandaag</Heading>
        <Text tone="muted">Werkorders die voor jou zijn ingepland voor vandaag.</Text>
      </Stack>

      <WorkItemsList currentUserId={session.userId} />
    </Stack>
  );
}
