import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { QuoteNumberingForm } from "../components/quote-numbering-form";
import { getQuoteNumberingSettings } from "./actions";

export const metadata = { title: "Quote numbering" };

/**
 * Per-tenant quote numbering (issue #228): prefix + next number. The
 * `"settings"` gate already ran in `../layout.tsx`; this leaf adds the
 * `quotes` feature gate and the `quote_numbering` module/`read` gate -
 * not entitled means the route doesn't resolve - and computes `canWrite` from
 * `update`.
 */
export default async function QuoteNumberingPage() {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "quotes"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "quote_numbering") || !can(actor, "quote_numbering", "read")) notFound();
  const canWrite = can(actor, "quote_numbering", "update");

  const settings = await getQuoteNumberingSettings();

  return <QuoteNumberingForm initial={settings} canWrite={canWrite} />;
}
