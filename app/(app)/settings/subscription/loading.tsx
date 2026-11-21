import { SettingsSectionSkeleton } from "../components/settings-section-skeleton";

// Route-level Suspense fallback for `/settings/subscription`: the frame paints header + nav.
export default function SubscriptionSettingsLoading() {
  return <SettingsSectionSkeleton rows={5} />;
}
