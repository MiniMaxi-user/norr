import { ClientDetailSkeleton } from "@/app/(app)/clients/[id]/client-detail-skeleton";

// Route-level Suspense fallback for `/articles/new` — same shaped detail-page skeleton as the read page.
export default function NewArticleLoading() {
  return <ClientDetailSkeleton />;
}
