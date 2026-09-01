import { Card, Skeleton, Stack } from "@yourorg/ui";
import { SETTINGS_NAV_GROUPS } from "./settings-nav-items";

/**
 * `Suspense` fallback for `SettingsLandingScreen` (design handoff "Settings
 * landing redesign") — shaped like the eventual content per docs/
 * ARCHITECTURE.md's "skeleton loading, not spinners": a placeholder title/
 * subtitle inside the dark band, then one placeholder card per
 * `SETTINGS_NAV_GROUPS` entry (so the grid doesn't visibly reflow once real
 * data streams in).
 */
export function SettingsLandingSkeleton() {
  return (
    <>
      <div className="ui-settings-landing-band" aria-hidden>
        <div className="ui-settings-landing-band-top">
          <div className="ui-settings-landing-band-titles">
            <Stack gap="sm">
              <Skeleton height="0.75rem" width="6rem" />
              <Skeleton height="2rem" width="8rem" />
              <Skeleton height="1rem" width="14rem" />
            </Stack>
          </div>
        </div>
      </div>
      <div className="ui-settings-landing-grid-wrap">
        <div className="ui-settings-landing-grid">
          {SETTINGS_NAV_GROUPS.map((group) => (
            <Card key={group.label} className="ui-settings-landing-card">
              <Stack gap="sm" aria-hidden>
                <Skeleton height="1.5rem" width="60%" />
                {group.items.map((item) => (
                  <Skeleton key={item.key} height="1.25rem" />
                ))}
              </Stack>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
