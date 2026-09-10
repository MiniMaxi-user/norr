import { WorkOrdersScreenSkeleton } from "./components/work-orders-screen-skeleton";

// Route-level Suspense fallback (issue #140) for `/work-orders` — reuses the
// exact skeleton `page.tsx` already renders as its own `<Suspense>`
// fallback.
export default function WorkOrdersLoading() {
  return <WorkOrdersScreenSkeleton />;
}
