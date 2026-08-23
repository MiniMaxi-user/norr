import { notFound } from "next/navigation";
import { Breadcrumbs, Heading, Stack } from "@yourorg/ui";
import { requireSession } from "@/lib/auth/session";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { getClient } from "../../actions";
import { ClientForm } from "../../client-form";

export const metadata = { title: "Edit client" };

/**
 * Full-page client edit form (docs/ARCHITECTURE.md "Popup vs. full page —
 * pick by weight, not habit") — replaces the old `ClientFormDialog` opened
 * from the client detail page's "Edit" button. Route-level RBAC gate: a
 * role without `update` on `clients` gets a 404 here, not just a hidden
 * button.
 */
export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };

  if (!can(actor, "clients", "update")) notFound();

  const result = await getClient(id);
  if (result.error || !result.data) notFound();
  const { client } = result.data;

  return (
    <Stack gap="lg">
      <Breadcrumbs
        items={[
          { label: "Clients", href: "/clients" },
          { label: client.name, href: `/clients/${client.id}` },
          { label: "Edit" },
        ]}
      />
      <Heading level={1}>Edit {client.name}</Heading>
      <ClientForm client={client} />
    </Stack>
  );
}
