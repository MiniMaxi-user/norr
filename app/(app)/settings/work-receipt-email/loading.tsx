import { SettingsFormSkeleton } from "../components/settings-section-skeleton";

// Route-level Suspense fallback for `/settings/work-receipt-email`: the real header plus placeholder cards.
export default function WorkReceiptEmailSettingsLoading() {
  return <SettingsFormSkeleton navKey="work_receipt_email" cards={3} />;
}
