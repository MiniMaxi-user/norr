import { RouteLoading } from "@/components/shell/route-loading";

// Route-level Suspense fallback (issue #140) for
// `/settings/reference-lists/[listKey]` — this leaf has no `Suspense`/
// skeleton of its own (`SettingsSectionSkeleton` exists but isn't wired as
// this page's own fallback — see `page.tsx`'s doc comment); uses the shared
// minimal fallback instead of adopting an unused skeleton.
export default function ReferenceListLeafLoading() {
  return <RouteLoading />;
}
