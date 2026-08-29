import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Heading, Stack, Text } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";

export const metadata = { title: "Settings" };

/**
 * Settings landing page — a plain, fast (no data fetch) Server Component
 * that gates the whole module (per docs/ARCHITECTURE.md: a module that
 * isn't entitled/accessible must not render, not just be shown disabled)
 * and links out to each settings section. Only "Reference lists" exists
 * today; a future section (e.g. organization profile, notification
 * preferences) is another `Card` link here, not a restructuring of this
 * page — kept as its own route group (rather than folding everything into
 * one page) specifically so that growth doesn't turn this into one giant
 * scroll of unrelated settings.
 */
export default async function SettingsPage() {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "settings"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "settings")) notFound();

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Heading level={1}>Settings</Heading>
        <Text tone="muted">Organization-wide configuration.</Text>
      </Stack>

      <Link href="/settings/reference-lists">
        <Card interactive>
          <Stack gap="xs">
            <Heading level={3}>Reference lists</Heading>
            <Text tone="muted">
              Configure the values available in Asset Type, Asset Status, and future picklists — tailored to your
              organization instead of a fixed, shared set. Everyone can view them; only the organization owner can
              change them.
            </Text>
          </Stack>
        </Card>
      </Link>

      <Link href="/settings/checklist-templates">
        <Card interactive>
          <Stack gap="xs">
            <Heading level={3}>Checklist templates</Heading>
            <Text tone="muted">
              Build reusable inspection/checklist forms — attach one to any work order to guide what an engineer
              checks off on-site. Everyone can view them; only the organization owner can change them.
            </Text>
          </Stack>
        </Card>
      </Link>

      <Link href="/settings/team">
        <Card interactive>
          <Stack gap="xs">
            <Heading level={3}>Team</Heading>
            <Text tone="muted">
              Invite colleagues and manage their role and access. Everyone can view active team members; only the
              organization owner can invite, change roles, or remove access.
            </Text>
          </Stack>
        </Card>
      </Link>
    </Stack>
  );
}
