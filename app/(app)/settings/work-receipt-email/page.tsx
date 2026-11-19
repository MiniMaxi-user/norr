import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { WorkReceiptEmailSettingsForm } from "../components/work-receipt-email-settings-form";
import { SettingsLoadError } from "../components/settings-load-error";
import { getWorkReceiptEmailSettings } from "./actions";

export const metadata = { title: "Work receipt email" };

/**
 * Per-tenant work receipt email configuration (issue #226): sender, CC, subject
 * and body templates used when a work receipt PDF is emailed. The `"settings"`
 * gate already ran in `../layout.tsx`; this leaf adds the `planning` feature
 * gate plus the `invoicing` module/read gate (same boundary as the invoice
 * email settings). `canWrite` comes from the action.
 */
export default async function WorkReceiptEmailSettingsPage() {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "planning"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "invoicing") || !can(actor, "invoicing", "read")) notFound();

  const result = await getWorkReceiptEmailSettings();
  if (!result.data) {
    return <SettingsLoadError navKey="work_receipt_email" message={result.error ?? "Could not load work receipt email settings."} />;
  }

  return <WorkReceiptEmailSettingsForm initial={result.data.settings} canWrite={result.data.canWrite} />;
}
