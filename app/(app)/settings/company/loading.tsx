import { SettingsFormSkeleton } from "../components/settings-section-skeleton";

// Route-level Suspense fallback for `/settings/company`: the real header plus placeholder cards.
export default function CompanySettingsLoading() {
  return <SettingsFormSkeleton navKey="company" cards={1} />;
}
