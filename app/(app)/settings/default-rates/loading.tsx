import { SettingsFormSkeleton } from "../components/settings-section-skeleton";

// Route-level Suspense fallback for `/settings/default-rates`: the real header plus placeholder cards.
export default function DefaultRatesSettingsLoading() {
  return <SettingsFormSkeleton navKey="default_rates" cards={2} />;
}
