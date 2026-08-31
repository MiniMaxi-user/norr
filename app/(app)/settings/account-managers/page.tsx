import { SectionHeader, Stack, Text } from "@yourorg/ui";
import { Settings } from "@yourorg/ui/icons";
import { getCurrentSession } from "@/lib/auth/session";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { listAccountManagers } from "@/lib/account-managers/actions";
import { getSettingsGroupIcon } from "../components/settings-nav-items";
import { AccountManagerManager } from "../components/account-manager-manager";

export const metadata = { title: "Account Managers" };

/**
 * Promoted out of the old Reference Lists tab board into its own top-level
 * leaf (issue #110, Settings admin shell stage 3) — same shape as
 * `../asset-models/page.tsx`. The `"settings"` feature/module gate already
 * ran in `app/(app)/settings/layout.tsx`; only `canWrite` is computed here.
 */
export default async function AccountManagersPage() {
  const session = await getCurrentSession();
  const actor: PermissionActor = { role: session?.role ?? null, isPlatformAdmin: session?.isPlatformAdmin ?? false };
  const canWrite = can(actor, "settings", "create");

  const result = await listAccountManagers();

  return (
    <Stack gap="lg">
      <SectionHeader icon={getSettingsGroupIcon("account_managers") ?? Settings} title="Account Managers" />
      <Text tone="muted">Colleagues who can be assigned as a client&rsquo;s account manager.</Text>
      <AccountManagerManager
        accountManagers={result.data?.accountManagers ?? []}
        loadError={result.error}
        canWrite={canWrite}
      />
    </Stack>
  );
}
