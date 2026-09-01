import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Heading, Stack, Text } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, canAccessModule, type PermissionActor } from "@/lib/rbac/permissions";
import { QuotesScreen } from "./components/quotes-screen";
import { QuotesScreenSkeleton } from "./components/quotes-screen-skeleton";

export const metadata = { title: "Quotes" };

interface QuotesPageProps {
  searchParams: Promise<{ page?: string; drafts?: string }>;
}

/**
 * Quotes module entry point (issue #16, third stage — frontend) — mirrors
 * `app/(app)/contracts/page.tsx`'s shape exactly: Server Component resolving
 * session/entitlement/RBAC once, handing everything data-dependent to a
 * screen component behind `Suspense` so the page shell paints immediately.
 *
 * Per docs/ARCHITECTURE.md ("a module/view that isn't entitled for the
 * tenant must not render, not just be disabled"): `hasFeature()` is checked
 * here, before anything module-specific renders, and `notFound()`s
 * otherwise — same gate `app/(app)/quotes/actions.ts` applies
 * server-action-side via `requireModuleContext`.
 *
 * Quotes is owner-or-planner-write, everyone-else-read
 * (`lib/rbac/permissions.ts`'s `quotes` row): the "New quote" toolbar action
 * below is gated on `can(actor, "quotes", "create")`, which only an owner or
 * planner satisfies — an engineer/finance/administratie never sees it, even
 * though they can still view the list.
 */
export default async function QuotesPage({ searchParams }: QuotesPageProps) {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "quotes"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!canAccessModule(actor, "quotes")) notFound();

  const params = await searchParams;
  const page = Math.max(0, Number.parseInt(params.page ?? "0", 10) || 0);
  // Issue #109 — auto-draft (system-managed shadow) quotes are hidden from
  // the default list view (`?drafts=1` reveals them) so `/quotes` isn't
  // cluttered with one shadow-quote per work order — see `QuotesScreen`'s own
  // doc comment for the full design.
  const showDrafts = params.drafts === "1";

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Heading level={1}>Quotes</Heading>
        <Text tone="muted">Pre-sale proposals, across every client.</Text>
      </Stack>

      <Suspense key={`${page}-${showDrafts}`} fallback={<QuotesScreenSkeleton />}>
        <QuotesScreen
          page={page}
          showDrafts={showDrafts}
          canCreate={can(actor, "quotes", "create")}
          canEdit={can(actor, "quotes", "update")}
          canDelete={can(actor, "quotes", "delete")}
        />
      </Suspense>
    </Stack>
  );
}
