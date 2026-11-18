import { WebListSkeleton } from "@yourorg/ui/web";

// Route-level Suspense fallback (issue #140) for `/clients`: the same
// list-page skeleton `page.tsx` uses as its own `<Suspense>` fallback.
export default function ClientsLoading() {
  return <WebListSkeleton module="Clients" title="Clients" columns={7} />;
}
