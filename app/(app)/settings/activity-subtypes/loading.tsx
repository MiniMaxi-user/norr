import { RouteLoading } from "@/components/shell/route-loading";

// Route-level Suspense fallback (issue #140) for
// `/settings/activity-subtypes` — this leaf has no `Suspense`/skeleton of
// its own; uses the shared minimal fallback.
export default function ActivitySubtypesLoading() {
  return <RouteLoading />;
}
