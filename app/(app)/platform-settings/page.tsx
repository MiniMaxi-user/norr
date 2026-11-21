import { Suspense } from "react";
import { notFound } from "next/navigation";
import { WebCardSkeleton, WebCardStack, WebSettingsHeader, WebSettingsMain, WebSettingsPage } from "@yourorg/ui/web";
import { getCurrentSession } from "@/lib/auth/session";
import { canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { DefaultModulesCard } from "./default-modules-card";

export const metadata = { title: "Platform settings" };

/**
 * Platform Admin's own cross-tenant settings landing page (issue #45) —
 * shape-matched to `app/(app)/settings/page.tsx` (plain, fast, no data
 * fetch Server Component that gates the whole page before rendering
 * anything), but deliberately NOT the usual `hasFeature(organization, ...)`
 * + `canAccessModule` two-step every other module page uses:
 * `session.organization` is `null` for a platform-admin-only account (no
 * tenant membership), and `hasFeature` always returns `false` when
 * `organization` is `null` — that combination would incorrectly 404 a real
 * platform admin. Instead this gates directly on `session.isPlatformAdmin`,
 * then still calls `canAccessModule(actor, "platform")` for the actual
 * authorization check, for consistency with how every other page in this
 * app authorizes (`lib/rbac/permissions.ts`'s `platform` module).
 *
 * Content: the default module bundle for new tenants (#246).
 */
export default async function PlatformSettingsPage() {
  const session = await getCurrentSession();
  if (!session?.isPlatformAdmin) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "platform")) notFound();

  return (
    <WebSettingsPage>
      <WebSettingsHeader breadcrumb={[{ label: "Platform settings" }]} title="Platform settings" />
      <WebSettingsMain>
        <WebCardStack>
          <Suspense fallback={<WebCardSkeleton rows={4} />}>
            <DefaultModulesCard />
          </Suspense>
        </WebCardStack>
      </WebSettingsMain>
    </WebSettingsPage>
  );
}
