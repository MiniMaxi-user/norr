import { SettingsFormSkeleton } from "../components/settings-section-skeleton";

// Route-level Suspense fallback for `/settings/activity-numbering`: the real header plus a placeholder card.
export default function ActivityNumberingLoading() {
  return <SettingsFormSkeleton navKey="activity_numbering" />;
}
