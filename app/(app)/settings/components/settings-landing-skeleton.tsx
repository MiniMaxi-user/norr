import { WebCardGrid, WebCardSkeleton } from "@yourorg/ui/web";
import { SETTINGS_NAV_GROUPS } from "./settings-nav-items";

/**
 * `Suspense` fallback for `SettingsLandingScreen`: the same card grid as the
 * landing, one placeholder card per `SETTINGS_NAV_GROUPS` entry (so the grid
 * doesn't reflow when the counts stream in). The frame already paints the
 * header, so this is just the body. Never a bare spinner.
 */
export function SettingsLandingSkeleton() {
  return (
    <div className="web-tab-stack" aria-busy="true">
      <span className="web-skeleton-bar" style={{ width: 320, height: 30 }} aria-hidden="true" />
      <WebCardGrid>
        {SETTINGS_NAV_GROUPS.map((group) => (
          <WebCardSkeleton key={group.label} rows={group.items.length} />
        ))}
      </WebCardGrid>
    </div>
  );
}
