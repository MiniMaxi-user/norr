import { ContractsScreenSkeleton } from "./components/contracts-screen-skeleton";

// Route-level Suspense fallback (issue #140) for `/contracts` — reuses the
// exact skeleton `page.tsx` already renders as its own `<Suspense>`
// fallback.
export default function ContractsLoading() {
  return <ContractsScreenSkeleton />;
}
