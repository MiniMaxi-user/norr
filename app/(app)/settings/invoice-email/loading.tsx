import { SettingsFormSkeleton } from "../components/settings-section-skeleton";

// Route-level Suspense fallback for `/settings/invoice-email`: the real header plus placeholder cards.
export default function InvoiceEmailSettingsLoading() {
  return <SettingsFormSkeleton navKey="invoice_email" cards={3} />;
}
