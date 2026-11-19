import { WebListSkeleton } from "@yourorg/ui/web";

// Route-level Suspense fallback (issue #140) for `/quotes`: the same
// list-page skeleton `page.tsx` uses as its own `<Suspense>` fallback.
export default function QuotesLoading() {
  return <WebListSkeleton module="Quotes" title="Quotes" columns={8} />;
}
