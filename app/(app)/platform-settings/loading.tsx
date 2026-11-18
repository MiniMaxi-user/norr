import { WebCardSkeleton, WebSettingsHeader, WebSettingsMain, WebSettingsPage } from "@yourorg/ui/web";

// Route-level Suspense fallback (issue #140) for `/platform-settings`: the real
// header plus a placeholder card.
export default function PlatformSettingsLoading() {
  return (
    <WebSettingsPage>
      <WebSettingsHeader breadcrumb={[{ label: "Platform settings" }]} title="Platform settings" />
      <WebSettingsMain aria-busy="true">
        <WebCardSkeleton rows={2} />
      </WebSettingsMain>
    </WebSettingsPage>
  );
}
