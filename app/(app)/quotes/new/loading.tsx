import { ClientDetailSkeleton } from "@/app/(app)/clients/[id]/client-detail-skeleton";

// Route-level Suspense fallback (issue #140) for `/quotes/new` - same shaped
// detail-page skeleton as the quote page itself (web design system, issue #222).
export default function NewQuoteLoading() {
  return <ClientDetailSkeleton />;
}
