import { WebListSkeleton } from "@yourorg/ui/web";

// Route-level Suspense fallback for `/invoices`: the same list-page skeleton
// `page.tsx` uses as its own `<Suspense>` fallback.
export default function InvoicesLoading() {
  return <WebListSkeleton module="Invoices" title="Invoices" columns={9} />;
}
