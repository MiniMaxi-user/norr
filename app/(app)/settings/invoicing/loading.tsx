import { SettingsFormSkeleton } from "../components/settings-section-skeleton";

// Route-level Suspense fallback for `/settings/invoicing`: the real header plus a placeholder card.
export default function InvoicingSettingsLoading() {
  return <SettingsFormSkeleton navKey="invoicing" cards={1} />;
}
