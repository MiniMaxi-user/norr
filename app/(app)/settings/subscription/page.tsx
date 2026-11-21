import { notFound } from "next/navigation";
import { WebCard, WebCardSection, WebCardStack, WebDataTableEmpty, WebStatusBadge } from "@yourorg/ui/web";
import { Inline, Stack, Text } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { roleLabel } from "../team/components/role-label";
import { getSubscriptionOverview, type SubscriptionModule } from "./actions";

export const metadata = { title: "Subscription" };

/**
 * Settings > Subscription (#249): the tenant's modules (core always included,
 * add-ons enabled / available) and the active users per role. Owner only via
 * the permission matrix (`subscription` / `read`) - anyone else gets a 404, the
 * route doesn't resolve. The `"settings"` gate already ran in `../layout.tsx`.
 * Read-only: modules are switched by Norr, not by the tenant.
 */
export default async function SubscriptionPage() {
  const session = await getCurrentSession();
  const actor: PermissionActor = { role: session?.role ?? null, isPlatformAdmin: session?.isPlatformAdmin ?? false };
  if (!can(actor, "subscription", "read")) notFound();

  const result = await getSubscriptionOverview();
  if (!result.data) {
    return (
      <WebCard title="Subscription">
        <WebDataTableEmpty>{result.error ?? "Could not load the subscription."}</WebDataTableEmpty>
      </WebCard>
    );
  }
  const overview = result.data;

  return (
    <WebCardStack>
      <WebCard title="Core modules" meta={`${overview.coreModules.length}`}>
        {overview.coreModules.map((module) => (
          <ModuleRowView key={module.key} module={module} badge={null} />
        ))}
      </WebCard>

      <WebCard title="Add-ons" meta={`${overview.enabledAddons.length} enabled`}>
        {overview.enabledAddons.map((module) => (
          <ModuleRowView key={module.key} module={module} badge={<WebStatusBadge tone="success">Enabled</WebStatusBadge>} />
        ))}
        {overview.availableAddons.map((module) => (
          <ModuleRowView key={module.key} module={module} badge={<WebStatusBadge tone="neutral">Available</WebStatusBadge>} />
        ))}
        <WebCardSection>
          <Text tone="muted">Want to add a module? Contact Norr to have it switched on for your organization.</Text>
        </WebCardSection>
      </WebCard>

      <WebCard title="Active users" meta={`${overview.totalUsers}`}>
        {overview.usersByRole.map(({ role, count }) => (
          <WebCardSection key={role}>
            <Inline justify="between">
              <Text>{roleLabel(role)}</Text>
              <Text tone="muted">{count}</Text>
            </Inline>
          </WebCardSection>
        ))}
      </WebCard>
    </WebCardStack>
  );
}

function ModuleRowView({ module, badge }: { module: SubscriptionModule; badge: React.ReactNode }) {
  return (
    <WebCardSection>
      <Inline justify="between" align="start" gap="md">
        <Stack gap="xs">
          <Text>
            <strong>{module.label}</strong>
          </Text>
          <Text tone="muted">{module.description}</Text>
        </Stack>
        {badge}
      </Inline>
    </WebCardSection>
  );
}
