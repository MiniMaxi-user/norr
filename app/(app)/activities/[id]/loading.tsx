import { RouteLoading } from "@/components/shell/route-loading";

// Route-level Suspense fallback (issue #140) for `/activities/[id]` — this
// detail page has no bespoke skeleton of its own, so it uses the shared
// minimal fallback (see `components/shell/route-loading.tsx`) rather than a
// new hand-built layout skeleton.
export default function ActivityDetailLoading() {
  return <RouteLoading />;
}
