import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
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
  if (!(await hasFeature(session.organization, "settings"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "settings")) notFound();

  return <SettingsShell>{children}</SettingsShell>;
}
