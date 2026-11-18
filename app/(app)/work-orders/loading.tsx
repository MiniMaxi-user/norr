import { WebListSkeleton } from "@yourorg/ui/web";

// Route-level Suspense fallback (issue #140) for `/work-orders` — the same
// shaped skeleton `page.tsx` uses as its own `<Suspense>` fallback.
export default function WorkOrdersLoading() {
  return <WebListSkeleton module="Work orders" title="Work orders" columns={7} />;
}
