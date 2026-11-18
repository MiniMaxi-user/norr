import { WebListSkeleton } from "@yourorg/ui/web";

// Route-level Suspense fallback (issue #140) for `/activities`: the same
// list-page skeleton `page.tsx` uses as its own `<Suspense>` fallback.
export default function ActivitiesLoading() {
  return <WebListSkeleton module="Activities" title="Activities" columns={6} />;
}
