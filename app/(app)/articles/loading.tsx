import { ArticlesScreenSkeleton } from "./components/articles-screen-skeleton";

// Route-level Suspense fallback (issue #140) for `/articles` — reuses the
// exact skeleton `page.tsx` already renders as its own `<Suspense>`
// fallback.
export default function ArticlesLoading() {
  return <ArticlesScreenSkeleton />;
}
