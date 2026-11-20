import { SettingsSectionSkeleton } from "../components/settings-section-skeleton";

// Route-level Suspense fallback for `/settings/email-outbox`: the frame paints the header, this is the table card.
export default function EmailOutboxLoading() {
  return <SettingsSectionSkeleton rows={6} />;
}
