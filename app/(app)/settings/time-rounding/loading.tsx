import { SettingsFormSkeleton } from "../components/settings-section-skeleton";

// Route-level Suspense fallback for `/settings/time-rounding`: the real header plus placeholder cards.
export default function TimeRoundingSettingsLoading() {
  return <SettingsFormSkeleton navKey="time_rounding" cards={2} />;
}
