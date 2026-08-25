import { notFound } from "next/navigation";
import { Card, Heading, Stack, Text } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";

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
 * No real settings content yet — an honest placeholder, per the approved
 * plan for this stage.
 */
export default async function PlatformSettingsPage() {
  const session = await getCurrentSession();
  if (!session?.isPlatformAdmin) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "platform")) notFound();

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Heading level={1}>Platform settings</Heading>
        <Text tone="muted">Cross-tenant configuration for Norr&rsquo;s own operators.</Text>
      </Stack>

      <Card>
        <Stack gap="xs">
          <Heading level={3}>Nothing configurable yet</Heading>
          <Text tone="muted">
            This is a placeholder. Platform-wide settings (e.g. default module bundles for new tenants, platform
            billing) will land here in a future stage.
          </Text>
        </Stack>
      </Card>
    </Stack>
  );
}
