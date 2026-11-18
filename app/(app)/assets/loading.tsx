import { WebListSkeleton } from "@yourorg/ui/web";

// Route-level Suspense fallback (issue #140) for `/assets`: the same
// list-page skeleton `page.tsx` uses as its own `<Suspense>` fallback.
export default function AssetsLoading() {
  return <WebListSkeleton module="Assets" title="Assets" columns={6} />;
}
