import { RouteLoading } from "@/components/shell/route-loading";

// Route-level Suspense fallback (issue #140) for `/settings/article-groups`
// — this leaf has no `Suspense`/skeleton of its own; uses the shared
// minimal fallback.
export default function ArticleGroupsLoading() {
  return <RouteLoading />;
}
