import { ClientDetailSkeleton } from "@/app/(app)/clients/[id]/client-detail-skeleton";

// Route-level Suspense fallback (issue #140) for `/work-orders/new` — the
// shaped detail-page skeleton of the web design system (issue #222).
export default function NewWorkOrderLoading() {
  return <ClientDetailSkeleton />;
}
