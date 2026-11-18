import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { getInvoiceEmailSettings } from "@/app/(app)/quotes/invoice-email-settings-actions";
import { InvoiceEmailSettingsForm } from "../components/invoice-email-settings-form";
import { SettingsLoadError } from "../components/settings-load-error";

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

  if (!settingsResult.data) {
    return <SettingsLoadError navKey="invoice_email" message={settingsResult.error ?? "Could not load invoice email settings."} />;
  }

  return <InvoiceEmailSettingsForm initial={settingsResult.data.settings} canWrite={canWrite} />;
}
