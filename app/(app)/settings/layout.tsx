import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { getEnabledFeatures } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { settingsKeysHiddenByModules } from "./components/settings-nav-items";
import { SettingsShell } from "./components/settings-shell";

/**
 * Settings admin shell (issue #110) — mounts the persistent grouped left
 * rail (`SettingsShell`) around every route under `/settings`, replacing the
 * old flat drill-down. This is the single entitlement gate for the whole
 * module now — every leaf `page.tsx` under `/settings` only computes its own
 * `canWrite`, it no longer repeats the `hasFeature`/`canAccessModule` checks
 * this layout already runs first.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  const enabledFeatures = await getEnabledFeatures(session.organization);
  if (!enabledFeatures.includes("settings")) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "settings")) notFound();

  // Owner-only section: not rendered in the nav for anyone else (#249).
  const hiddenKeys = [
    ...(can(actor, "subscription", "read") ? [] : ["subscription"]),
    // Sections of modules that are off for this tenant (#247).
    ...settingsKeysHiddenByModules(enabledFeatures),
  ];

  return <SettingsShell hiddenKeys={hiddenKeys}>{children}</SettingsShell>;
}
