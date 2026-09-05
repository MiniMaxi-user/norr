import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { listAccountManagers } from "@/lib/account-managers/actions";
import { listArticlesForSelect } from "@/app/(app)/articles/actions";
import { ClientCreateScreen } from "../components/client-create-screen";

export const metadata = { title: "New Client" };

/**
 * `mode: "create"` render of the client Details fields (Client Details tab
 * redo) — replaces the old `NewClientPanel` slide-in dialog. Gated on
 * `can(actor, "clients", "create")` — owner only, matching `createClient`'s
 * own RBAC check (and the RLS INSERT policy) exactly, same pattern
 * `app/(app)/assets/new/page.tsx` uses for Assets.
 */
export default async function NewClientPage() {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "clients"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "clients")) notFound();
  if (!can(actor, "clients", "create")) notFound();

  const [accountManagersResult, articlesResult] = await Promise.all([
    listAccountManagers(),
    listArticlesForSelect(),
  ]);

  return (
    <ClientCreateScreen
      breadcrumbItems={[{ label: "Clients", href: "/clients" }, { label: "New client" }]}
      accountManagers={accountManagersResult.data?.accountManagers ?? []}
      articles={articlesResult.data?.articles ?? []}
      todayIso={new Date().toISOString().slice(0, 10)}
    />
  );
}
