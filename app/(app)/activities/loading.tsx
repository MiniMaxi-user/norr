import { ActivitiesScreenSkeleton } from "./components/activities-screen-skeleton";

// Route-level Suspense fallback (issue #140) for `/activities` — reuses the
// exact skeleton `page.tsx` already renders as its own `<Suspense>`
// fallback, so hard navigation and client-side navigation show the same
// shaped loading state.
export default function ActivitiesLoading() {
  return <ActivitiesScreenSkeleton />;
}
