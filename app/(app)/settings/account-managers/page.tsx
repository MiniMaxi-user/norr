import { getCurrentSession } from "@/lib/auth/session";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { listAccountManagers } from "@/lib/account-managers/actions";
import { AccountManagerManager } from "../components/account-manager-manager";

export const metadata = { title: "Account Managers" };

/**
 * Account managers leaf (issue #110 settings shell; design system #222). The
 * `"settings"` feature/module gate already ran in `app/(app)/settings/layout.tsx`;
 * only `canWrite` is computed here. The card carries the title.
 */
export default async function AccountManagersPage() {
  const session = await getCurrentSession();
  const actor: PermissionActor = { role: session?.role ?? null, isPlatformAdmin: session?.isPlatformAdmin ?? false };
  const canWrite = can(actor, "settings", "create");

  const result = await listAccountManagers();

  return (
    <AccountManagerManager
      accountManagers={result.data?.accountManagers ?? []}
      loadError={result.error}
      canWrite={canWrite}
    />
  );
}
