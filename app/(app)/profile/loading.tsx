import { WebCardSkeleton, WebSettingsHeader, WebSettingsMain, WebSettingsPage } from "@yourorg/ui/web";

// Route-level Suspense fallback (issue #140) for `/profile`: the real header
// plus a placeholder Details card.
export default function ProfileLoading() {
  return (
    <WebSettingsPage>
      <WebSettingsHeader breadcrumb={[{ label: "Profile" }]} title="Profile" />
      <WebSettingsMain aria-busy="true">
        <div className="web-card-stack">
          <WebCardSkeleton rows={3} />
          <WebCardSkeleton rows={2} />
        </div>
      </WebSettingsMain>
    </WebSettingsPage>
  );
}
