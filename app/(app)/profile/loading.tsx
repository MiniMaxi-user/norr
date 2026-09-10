import { RouteLoading } from "@/components/shell/route-loading";

// Route-level Suspense fallback (issue #140) for `/profile` — low-traffic,
// no bespoke skeleton (the page's own content is almost always instantly
// covered by `ProfilePanel`'s slide-over); uses the shared minimal
// fallback.
export default function ProfileLoading() {
  return <RouteLoading />;
}
