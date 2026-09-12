import { getCurrentEngineerSession } from "@/lib/auth/session";
import { TodayScreen } from "./today-screen";

/**
 * Today's-work-orders overview for the logged-in engineer (issue #169,
 * redesigned per issue #170/IMPLEMENTATION.md §6). Stays a thin Server
 * Component — `requireEngineerSession()` in `app/(app)/layout.tsx` is still
 * the server-side gate for the online case — but the actual screen (fetch +
 * IndexedDB fallback + pull-to-refresh + the local timer/sign-off state
 * folded in) has to be a client component (`TodayScreen`), since it must
 * keep rendering with zero network after a prior successful sync.
 *
 * Reads the session again here (already resolved once by the layout's
 * `requireEngineerSession()` — `getCurrentEngineerSession()` is
 * `cache()`-wrapped per request, so this is a free re-read, not a second
 * round-trip) to hand `userId`/`fullName`/`email` down: `userId` scopes the
 * offline cache (`lib/offline/db.ts`) so a later engineer on the same
 * device never reads an earlier one's cached work orders, and
 * `fullName`/`email` are what the profile button/sheet display.
 */
export default async function TodayPage() {
  const session = await getCurrentEngineerSession();
  // The layout above already redirects to /login when there's no valid
  // engineer session — this is only reachable with one. If it's ever null
  // here regardless (shouldn't happen), there's no safe userId to scope the
  // offline cache to, so render nothing rather than fall back to an
  // unscoped (leak-prone) cache read.
  if (!session) return null;

  return <TodayScreen currentUserId={session.userId} fullName={session.fullName} email={session.email} />;
}
