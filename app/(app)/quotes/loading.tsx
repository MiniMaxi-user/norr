import { QuotesScreenSkeleton } from "./components/quotes-screen-skeleton";

// Route-level Suspense fallback (issue #140) for `/quotes` — reuses the
// exact skeleton `page.tsx` already renders as its own `<Suspense>`
// fallback.
export default function QuotesLoading() {
  return <QuotesScreenSkeleton />;
}
