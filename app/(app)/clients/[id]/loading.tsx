import { ClientDetailSkeleton } from "./client-detail-skeleton";

// Route-level Suspense fallback (issue #140) for `/clients/[id]` — reuses
// the exact skeleton `page.tsx` already renders as its own `<Suspense>`
// fallback around `ClientDetailContent`.
export default function ClientDetailLoading() {
  return <ClientDetailSkeleton />;
}
