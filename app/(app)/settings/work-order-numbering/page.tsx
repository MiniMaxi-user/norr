import { notFound } from "next/navigation";
import { OverviewHeroBand, Stack } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { WorkOrderNumberingForm } from "../components/work-order-numbering-form";
import { getWorkOrderNumberingSettings } from "./actions";

export const metadata = { title: "Work order numbering" };

/**
 * Per-tenant work order numbering (issue #218): prefix + next number. The
 * `"settings"` gate already ran in `../layout.tsx`; this leaf adds the
 * `planning` feature gate and the `work_order_numbering` module/`read` gate -
 * not entitled means the route doesn't resolve - and computes `canWrite` from
 * `update`.
 */
export default async function WorkOrderNumberingPage() {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "planning"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "work_order_numbering") || !can(actor, "work_order_numbering", "read")) notFound();
  const canWrite = can(actor, "work_order_numbering", "update");

  const settings = await getWorkOrderNumberingSettings();

  return (
    <Stack gap="lg">
      <OverviewHeroBand
        title="Work order numbering"
        subtitle="every work order gets a unique number automatically: the prefix followed by a running number."
      />
      <WorkOrderNumberingForm initial={settings} canWrite={canWrite} />
    </Stack>
  );
}
