import { RouteLoading } from "@/components/shell/route-loading";

// Route-level Suspense fallback for `/settings/invoice-email` - same shared
// minimal fallback as `../time-rounding/loading.tsx`.
export default function InvoiceEmailLoading() {
  return <RouteLoading />;
}
