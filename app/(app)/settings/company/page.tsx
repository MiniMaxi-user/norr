import { getCurrentSession } from "@/lib/auth/session";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { getOrganizationCompanySettings, listClientsForOwnClientSelect } from "../company-actions";
import { OrganizationCompanyForm } from "../components/organization-company-form";
import { SettingsLoadError } from "../components/settings-load-error";

export const metadata = { title: "Company" };

/**
 * Settings > Company (issue #120, "Via instellingen is de eigen 'Client' te
 * selecteren") — own top-level Settings leaf (see `../components/
 * settings-nav-items.ts`'s new "Company" group), same lightweight
 * "single async page.tsx, two awaited reads, no Suspense" shape as
 * `../default-rates/page.tsx`. The `"settings"` feature/module gate already
 * ran in `app/(app)/settings/layout.tsx`; only `canWrite` is computed here —
 * `can(actor, "settings", "update")` is owner-only, matching
 * `updateOrganizationOwnClient`'s own gate (see `../company-actions.ts`'s
 * header comment).
 */
export default async function CompanySettingsPage() {
  const session = await getCurrentSession();
  const actor: PermissionActor = { role: session?.role ?? null, isPlatformAdmin: session?.isPlatformAdmin ?? false };
  const canWrite = can(actor, "settings", "update");
  const canEditLogo = canWrite && can(actor, "clients", "update");

  const [settingsResult, clientsResult] = await Promise.all([
    getOrganizationCompanySettings(),
    listClientsForOwnClientSelect(),
  ]);

  if (!settingsResult.data) {
    return <SettingsLoadError navKey="company" message={settingsResult.error ?? "Could not load company settings."} />;
  }

  return (
    <OrganizationCompanyForm
      initial={settingsResult.data}
      clients={clientsResult.data?.clients ?? []}
      canWrite={canWrite}
      canEditLogo={canEditLogo}
    />
  );
}
