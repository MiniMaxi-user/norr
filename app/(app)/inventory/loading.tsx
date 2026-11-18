import { WebListSkeleton } from "@yourorg/ui/web";

// Route-level Suspense fallback (issue #140) for `/inventory`: the same
// list-page skeleton `page.tsx` uses as its own `<Suspense>` fallback.
export default function InventoryLoading() {
  return <WebListSkeleton module="Inventory" title="Inventory" columns={6} />;
}
