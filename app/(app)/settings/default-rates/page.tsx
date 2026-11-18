import { getCurrentSession } from "@/lib/auth/session";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { getOrganizationDefaultRateSettings } from "../organization-rate-actions";
import { listArticlesForSelect } from "@/app/(app)/articles/actions";
import { OrganizationDefaultRateForm } from "../components/organization-default-rate-form";
import { SettingsLoadError } from "../components/settings-load-error";

export const metadata = { title: "Default Rates" };

/**
 * Org-level default Travel/Work billing rate settings (issue #109 acceptance
 * criterion 4) — own top-level Settings leaf (see `../components/
 * settings-nav-items.ts`'s new "Billing" group), same "single async
 * page.tsx, no Suspense" shape `../asset-models/page.tsx`/`../account-managers/
 * page.tsx` already establish (two lightweight queries, nothing worth
 * streaming around). The `"settings"` feature/module gate already ran in
 * `app/(app)/settings/layout.tsx`; only `canWrite` is computed here — see
 * `../organization-rate-actions.ts`'s header comment for why this is
 * `can(actor, "settings", "update")` (owner-only) rather than the more
 * permissive create/update split most other settings managers use.
 */
export default async function DefaultRatesPage() {
  const session = await getCurrentSession();
  const actor: PermissionActor = { role: session?.role ?? null, isPlatformAdmin: session?.isPlatformAdmin ?? false };
  const canWrite = can(actor, "settings", "update");

  const [settingsResult, articlesResult] = await Promise.all([
    getOrganizationDefaultRateSettings(),
    listArticlesForSelect(),
  ]);

  if (!settingsResult.data) {
    return <SettingsLoadError navKey="default_rates" message={settingsResult.error ?? "Could not load default rate settings."} />;
  }

  return (
    <OrganizationDefaultRateForm
      initial={settingsResult.data}
      articles={articlesResult.data?.articles ?? []}
      canWrite={canWrite}
    />
  );
}
