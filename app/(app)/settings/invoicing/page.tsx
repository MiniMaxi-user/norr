import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { getInvoiceSettings } from "@/app/(app)/quotes/invoice-settings-actions";
import { InvoiceSettingsForm } from "../components/invoice-settings-form";
import { SettingsLoadError } from "../components/settings-load-error";

export const metadata = { title: "Invoicing" };

/**
 * Per-tenant invoicing settings (issue #232): the default payment term. Same
 * gates as `../invoice-email/page.tsx`: the `"settings"` gate already ran in
 * `../layout.tsx`; this leaf adds the `invoicing` gate (feature + module +
 * `read`) and computes `canWrite` from `can(actor, "invoicing", "create")`.
 */
export default async function InvoicingSettingsPage() {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "invoicing"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "invoicing") || !can(actor, "invoicing", "read")) notFound();
  const canWrite = can(actor, "invoicing", "create");

  const settingsResult = await getInvoiceSettings();

  if (!settingsResult.data) {
    return <SettingsLoadError navKey="invoicing" message={settingsResult.error ?? "Could not load invoicing settings."} />;
  }

  return <InvoiceSettingsForm initial={settingsResult.data.settings} canWrite={canWrite} />;
}
