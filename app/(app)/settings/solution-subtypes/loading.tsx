import { RouteLoading } from "@/components/shell/route-loading";

// Route-level Suspense fallback (issue #140) for
// `/settings/solution-subtypes` — this leaf has no `Suspense`/skeleton of
// its own; uses the shared minimal fallback.
export default function SolutionSubtypesLoading() {
  return <RouteLoading />;
}
