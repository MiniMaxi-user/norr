import { notFound } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { listAccountManagers } from "@/lib/account-managers/actions";
import { listArticlesForSelect } from "@/app/(app)/articles/actions";
import { ClientNewScreen } from "./client-new-screen";

export const metadata = { title: "New Client" };

/**
 * `/clients/new` — the client detail page rendered in `mode="new"` (design
 * system, issue #222), replacing the old separate create screen. Gated on
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
    <ClientNewScreen
      accountManagers={accountManagersResult.data?.accountManagers ?? []}
      articles={articlesResult.data?.articles ?? []}
      todayIso={new Date().toISOString().slice(0, 10)}
    />
  );
}
