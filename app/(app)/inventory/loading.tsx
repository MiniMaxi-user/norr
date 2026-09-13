import { InventoryScreenSkeleton } from "./components/inventory-screen-skeleton";

// Route-level Suspense fallback (issue #140 precedent) for `/inventory` —
// reuses the exact skeleton `page.tsx` already renders as its own
// `<Suspense>` fallback.
export default function InventoryLoading() {
  return <InventoryScreenSkeleton />;
}
