import { SettingsFormSkeleton } from "../components/settings-section-skeleton";

// Route-level Suspense fallback for `/settings/contract-numbering`: the real header plus a placeholder card.
export default function ContractNumberingLoading() {
  return <SettingsFormSkeleton navKey="contract_numbering" />;
}
