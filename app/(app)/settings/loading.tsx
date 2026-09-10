import { SettingsLandingSkeleton } from "./components/settings-landing-skeleton";

// Route-level Suspense fallback (issue #140) for `/settings` — reuses the
// exact skeleton `page.tsx` already renders as its own `<Suspense>`
// fallback around `SettingsLandingScreen`.
export default function SettingsLoading() {
  return <SettingsLandingSkeleton />;
}
