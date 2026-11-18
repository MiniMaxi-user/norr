import { WebListSkeleton } from "@yourorg/ui/web";

// Route-level Suspense fallback (issue #140) for `/articles`: the same
// list-page skeleton `page.tsx` uses as its own `<Suspense>` fallback.
export default function ArticlesLoading() {
  return <WebListSkeleton module="Articles" title="Articles" columns={9} />;
}
