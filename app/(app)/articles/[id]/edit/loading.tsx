import { RouteLoading } from "@/components/shell/route-loading";

// Route-level Suspense fallback (issue #140) for `/articles/[id]/edit` — no
// bespoke skeleton for this route; uses the shared minimal fallback.
export default function EditArticleLoading() {
  return <RouteLoading />;
}
