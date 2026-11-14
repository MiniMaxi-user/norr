import { RouteLoading } from "@/components/shell/route-loading";

// Route-level Suspense fallback for `/settings/contract-numbering`.
export default function ContractNumberingLoading() {
  return <RouteLoading />;
}
