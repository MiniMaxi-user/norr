import { notFound } from "next/navigation";
import { Breadcrumbs, Heading, Stack } from "@yourorg/ui";
import { requireSession } from "@/lib/auth/session";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { ClientForm } from "../client-form";

export const metadata = { title: "Add client" };

/**
 * Full-page client create form (docs/ARCHITECTURE.md "Popup vs. full page —
 * pick by weight, not habit") — replaces the old `ClientFormDialog` opened
 * from the Clients list toolbar. Route-level RBAC gate (not just hiding the
 * "Add client" button): a role without `create` on `clients` gets a 404
 * here, same as every other module-gated page in this app.
 */
export default async function NewClientPage() {
  const session = await requireSession();
  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };

  if (!can(actor, "clients", "create")) notFound();

  return (
    <Stack gap="lg">
      <Breadcrumbs items={[{ label: "Clients", href: "/clients" }, { label: "Add client" }]} />
      <Heading level={1}>Add client</Heading>
      <ClientForm />
    </Stack>
  );
}
