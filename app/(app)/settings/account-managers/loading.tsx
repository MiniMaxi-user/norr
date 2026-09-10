import { RouteLoading } from "@/components/shell/route-loading";

// Route-level Suspense fallback (issue #140) for
// `/settings/account-managers` — this leaf has no `Suspense`/skeleton of its
// own (a single lightweight query, awaited directly in `page.tsx`); uses the
// shared minimal fallback.
export default function AccountManagersLoading() {
  return <RouteLoading />;
}
