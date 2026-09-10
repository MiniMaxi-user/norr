import { RouteLoading } from "@/components/shell/route-loading";

// Route-level Suspense fallback (issue #140) for `/signup` — low-traffic,
// no bespoke skeleton; uses the shared minimal fallback.
export default function SignUpLoading() {
  return <RouteLoading />;
}
