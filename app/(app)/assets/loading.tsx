import { AssetsScreenSkeleton } from "./components/assets-screen-skeleton";

// Route-level Suspense fallback (issue #140) for `/assets` — reuses the
// exact skeleton `page.tsx` already renders as its own `<Suspense>`
// fallback. `loading.tsx` files receive no `searchParams` (Next.js
// convention), so this can't know the caller's `?view=`/last-used-view
// cookie the way `page.tsx` does — defaults to `"list"`, the same fallback
// `page.tsx` itself uses when neither is set.
export default function AssetsLoading() {
  return <AssetsScreenSkeleton view="list" />;
}
