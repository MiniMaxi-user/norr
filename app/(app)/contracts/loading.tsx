import { WebListSkeleton } from "@yourorg/ui/web";

// Route-level Suspense fallback (issue #140) for `/contracts`: the same
// list-page skeleton `page.tsx` uses as its own `<Suspense>` fallback.
export default function ContractsLoading() {
  return <WebListSkeleton module="Contracts" title="Contracts" columns={9} />;
}
