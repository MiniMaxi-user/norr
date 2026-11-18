import { ClientDetailSkeleton } from "@/app/(app)/clients/[id]/client-detail-skeleton";

// Route-level Suspense fallback (issue #140) for `/contracts/new` — the shaped
// detail-page skeleton of the web design system (issue #222): white header,
// key/value cards, rail. Same layout classes as the real page.
export default function NewContractLoading() {
  return <ClientDetailSkeleton />;
}
