import { ClientsSkeleton } from "./components/clients-skeleton";

// Route-level Suspense fallback (issue #140) for `/clients` — reuses the
// exact skeleton `page.tsx` already renders as its own `<Suspense>`
// fallback.
export default function ClientsLoading() {
  return <ClientsSkeleton />;
}
