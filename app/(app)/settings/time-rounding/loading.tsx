import { RouteLoading } from "@/components/shell/route-loading";

// Route-level Suspense fallback (issue #140) for `/settings/time-rounding` —
// this leaf has no `Suspense`/skeleton of its own; uses the shared minimal
// fallback, same as `../default-rates/loading.tsx`.
export default function TimeRoundingLoading() {
  return <RouteLoading />;
}
