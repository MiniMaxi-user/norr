import { OverviewHeroBand, Stack, Text } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { getOrganizationDefaultRateSettings } from "../organization-rate-actions";
import { listArticlesForSelect } from "@/app/(app)/articles/actions";
import { OrganizationDefaultRateForm } from "../components/organization-default-rate-form";

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

  return (
    <Stack gap="lg">
      <OverviewHeroBand
        title="Default Rates"
        subtitle="Fallback Travel-time and Work-time billing articles, used whenever a client or engineer has no custom rate of their own (Settings → Team, or a client&rsquo;s own detail page). The sale price always mirrors the picked article and can&rsquo;t be overridden here."
      />
      {settingsResult.data ? (
        <OrganizationDefaultRateForm
          initial={settingsResult.data}
          articles={articlesResult.data?.articles ?? []}
          canWrite={canWrite}
        />
      ) : (
        <Text tone="danger">{settingsResult.error ?? "Could not load default rate settings."}</Text>
      )}
    </Stack>
  );
}
