import { ClientDetailSkeleton } from "@/app/(app)/clients/[id]/client-detail-skeleton";

// Route-level Suspense fallback for `/activities/new` — same shaped
// detail-page skeleton as the read page.
export default function NewActivityLoading() {
  return <ClientDetailSkeleton />;
}
