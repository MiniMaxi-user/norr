import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { ActivityNumberingForm } from "../components/activity-numbering-form";
import { getActivityNumberingSettings } from "./actions";

export const metadata = { title: "Activity numbering" };

/**
 * Per-tenant activity numbering (issue #228): prefix + next number. The
 * `"settings"` gate already ran in `../layout.tsx`; this leaf adds the
 * `activities` feature gate and the `activity_numbering` module/`read` gate -
 * not entitled means the route doesn't resolve - and computes `canWrite` from
 * `update`.
 */
export default async function ActivityNumberingPage() {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "activities"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "activity_numbering") || !can(actor, "activity_numbering", "read")) notFound();
  const canWrite = can(actor, "activity_numbering", "update");

  const settings = await getActivityNumberingSettings();

  return <ActivityNumberingForm initial={settings} canWrite={canWrite} />;
}
