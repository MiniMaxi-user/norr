import { SettingsFormSkeleton } from "../components/settings-section-skeleton";

// Route-level Suspense fallback for `/settings/work-order-numbering`: the real header plus a placeholder card.
export default function WorkOrderNumberingLoading() {
  return <SettingsFormSkeleton navKey="work_order_numbering" />;
}
