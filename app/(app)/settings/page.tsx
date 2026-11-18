import { Suspense } from "react";
import { SettingsLandingScreen } from "./components/settings-landing-screen";
import { SettingsLandingSkeleton } from "./components/settings-landing-skeleton";

export const metadata = { title: "Settings" };

/**
 * Settings landing page (web design system, issue #222): one card per
 * settings group, each listing its sections as link rows with a live item
 * count. Renders inside `SettingsShell` (`layout.tsx`), which runs the
 * `"settings"` feature/module gate for every route under `/settings` and
 * supplies the header; this page has no writes of its own, so it needs no
 * `canWrite`. Data-fetching is handed to `SettingsLandingScreen` behind
 * `Suspense` so the frame paints immediately.
 */
export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsLandingSkeleton />}>
      <SettingsLandingScreen />
    </Suspense>
  );
}
