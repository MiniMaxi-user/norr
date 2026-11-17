import { RouteLoading } from "@/components/shell/route-loading";

// Route-level Suspense fallback for `/settings/work-order-numbering`.
export default function WorkOrderNumberingLoading() {
  return <RouteLoading />;
}
