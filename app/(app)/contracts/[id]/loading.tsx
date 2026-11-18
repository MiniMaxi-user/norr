import { ClientDetailSkeleton } from "@/app/(app)/clients/[id]/client-detail-skeleton";

// Route-level Suspense fallback (issue #140) for `/contracts/[id]` — the shaped
// detail-page skeleton of the web design system (issue #222): white header,
// key/value cards, rail. Same layout classes as the real page.
export default function ContractDetailLoading() {
  return <ClientDetailSkeleton />;
}
