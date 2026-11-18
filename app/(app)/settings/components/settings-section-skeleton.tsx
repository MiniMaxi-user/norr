import { WebCardSkeleton, WebSettingsHeader, WebSettingsMain } from "@yourorg/ui/web";
import { findSettingsNavItemByKey } from "./settings-nav-items";

/**
 * Shaped `Suspense` fallback for a settings leaf's data-fetching board
 * (docs/ARCHITECTURE.md "skeleton loading, not spinners") — one card of
 * placeholder rows, parameterized by row count so every list/tree settings
 * leaf can share it. The settings frame paints the header and the nav, so
 * this is only the body.
 */
export function SettingsSectionSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true">
      <WebCardSkeleton rows={rows} />
    </div>
  );
}

/**
 * `loading.tsx` / Suspense fallback of a form-type settings page. Those
 * pages render their own header (Edit / Save), so this paints the real
 * header (title and breadcrumb known at once) above placeholder cards.
 */
export function SettingsFormSkeleton({ navKey, cards = 1, rows = 3 }: { navKey: string; cards?: number; rows?: number }) {
  const { group, item } = findSettingsNavItemByKey(navKey);
  return (
    <>
      <WebSettingsHeader
        breadcrumb={[{ label: "Settings", href: "/settings" }, { label: item.label }]}
        title={item.label}
        badge={group.label !== item.label ? group.label : null}
      />
      <WebSettingsMain aria-busy="true">
        <div className="web-tab-stack">
          {Array.from({ length: cards }).map((_, index) => (
            <WebCardSkeleton key={index} rows={rows} />
          ))}
        </div>
      </WebSettingsMain>
    </>
  );
}
