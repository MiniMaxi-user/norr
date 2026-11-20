import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { listOutbox } from "./actions";
import { OutboxTable } from "./outbox-table";

export const metadata = { title: "Outbox" };

/**
 * Settings -> Outbox (issue #268): every invoice / credit note / work receipt
 * e-mail of the last 30 days with its status, plus how many are still queued.
 * Same gate as Settings -> Invoice email: the `invoicing` feature + module and
 * the create right (owner / finance / administratie); otherwise the route
 * doesn't resolve. The `"settings"` gate already ran in `../layout.tsx`.
 */
export default async function EmailOutboxPage() {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "invoicing"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "invoicing") || !can(actor, "invoicing", "create")) notFound();

  const result = await listOutbox();

  return (
    <OutboxTable
      items={result.data?.items ?? []}
      pendingCount={result.data?.pendingCount ?? 0}
      days={result.data?.days ?? 30}
      loadError={result.error}
    />
  );
}
