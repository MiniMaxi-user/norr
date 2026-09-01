import { Suspense } from "react";
import { SettingsLandingScreen } from "./components/settings-landing-screen";
import { SettingsLandingSkeleton } from "./components/settings-landing-skeleton";

export const metadata = { title: "Settings" };

/**
 * Settings landing page (design handoff "Settings landing redesign", option
 * 2a) — replaces the old `redirect("/settings/reference-lists/asset_type")`
 * with a real overview: a dark header band (live "N configurable lists
 * across M areas" counts + search) over a grouped card grid, one card per
 * `SettingsNavGroup` (`./components/settings-nav-items.ts`), each listing
 * its own items with a live item count. Renders inside `SettingsShell`
 * (`app/(app)/settings/layout.tsx`), which no longer wraps a persistent left
 * rail around it — see `SettingsShell`'s own doc comment. That layout
 * already runs the `"settings"` feature/module gate for every
 * route under `/settings` (see its own doc comment on why leaf pages don't
 * repeat it), and this page has no writes of its own, so unlike most other
 * settings leaves it doesn't even need its own `canWrite` computation.
 *
 * Data-fetching is handed to `SettingsLandingScreen` behind `Suspense`, same
 * "Server Component resolves the gate synchronously, a Screen component
 * streams in the data" shape `app/(app)/work-orders/page.tsx` uses.
 */
export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsLandingSkeleton />}>
      <SettingsLandingScreen />
    </Suspense>
  );
}
