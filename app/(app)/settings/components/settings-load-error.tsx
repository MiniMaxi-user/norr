import { WebCard, WebDataTableEmpty, WebSettingsHeader, WebSettingsMain } from "@yourorg/ui/web";
import { findSettingsNavItemByKey } from "./settings-nav-items";

/**
 * Body of a form-type settings page whose data could not be loaded. Those
 * pages render their own header, so this paints the real header above one
 * card with the (already user-safe) error message.
 */
export function SettingsLoadError({ navKey, message }: { navKey: string; message: string }) {
  const { group, item } = findSettingsNavItemByKey(navKey);
  return (
    <>
      <WebSettingsHeader
        breadcrumb={[{ label: "Settings", href: "/settings" }, { label: item.label }]}
        title={item.label}
        badge={group.label !== item.label ? group.label : null}
      />
      <WebSettingsMain>
        <WebCard title="Could not load">
          <WebDataTableEmpty>{message}</WebDataTableEmpty>
        </WebCard>
      </WebSettingsMain>
    </>
  );
}
