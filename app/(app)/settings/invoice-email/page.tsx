import { notFound } from "next/navigation";
import { OverviewHeroBand, Stack, Text } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { getInvoiceEmailSettings } from "@/app/(app)/quotes/invoice-email-settings-actions";
import { InvoiceEmailSettingsForm } from "../components/invoice-email-settings-form";

export const metadata = { title: "Invoice email" };

/**
 * Per-tenant invoice email configuration (issue #211): sender, CC, subject
 * and body templates used when an invoice is emailed to the client's invoice
 * contact. The `"settings"` gate already ran in `../layout.tsx`; this leaf
 * adds the `invoicing` gate (feature + module + `read`) - not entitled means
 * the route doesn't resolve at all - and computes `canWrite` from
 * `can(actor, "invoicing", "create")`, same boundary as invoicing itself.
 */
export default async function InvoiceEmailSettingsPage() {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "invoicing"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "invoicing") || !can(actor, "invoicing", "read")) notFound();
  const canWrite = can(actor, "invoicing", "create");

  const settingsResult = await getInvoiceEmailSettings();

  return (
    <Stack gap="lg">
      <OverviewHeroBand
        title="Invoice email"
        subtitle="How invoices are emailed to your clients' invoice contact: sender, CC, subject and message. Leave a field empty to use the default."
      />
      {settingsResult.data ? (
        <InvoiceEmailSettingsForm initial={settingsResult.data.settings} canWrite={canWrite} />
      ) : (
        <Text tone="danger">{settingsResult.error ?? "Could not load invoice email settings."}</Text>
      )}
    </Stack>
  );
}
