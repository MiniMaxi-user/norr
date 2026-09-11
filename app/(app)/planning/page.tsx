import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Stack } from "@yourorg/ui";
import { getCurrentSession } from "@/lib/auth/session";
import { hasFeature } from "@/lib/rbac/features";
import { can, type PermissionActor } from "@/lib/rbac/permissions";
import { preferencesStore } from "@/lib/preferences/cookie-store";
import { PlanningBoard } from "./components/planning-board";
import { PlanningBoardSkeleton } from "./components/planning-board-skeleton";
import { parseDateParam, formatDateParam } from "./date-utils";
import type { PlanningGroup, PlanningView } from "./types";

export const metadata = { title: "Planning" };

interface PlanningPageProps {
  searchParams: Promise<{
    date?: string;
    view?: string;
    group?: string;
  }>;
}

function parseView(raw: string | undefined): PlanningView | undefined {
  return raw === "day" || raw === "week" ? raw : undefined;
}

function parseGroup(raw: string | undefined): PlanningGroup | undefined {
  return raw === "region" || raw === "engineer" ? raw : undefined;
}

/**
 * Planning module entry point (issue #164) — the drag-and-drop dispatcher
 * board. Server Component: resolves session/entitlement/RBAC once here (and
 * `notFound()`s a non-owner/planner actor entirely, matching
 * `components/shell/nav-items.ts`'s own "must not render, not just be
 * disabled" gate for this same route — see that file's `requiredPermission`
 * comment), then hands everything data-dependent to `PlanningBoard` behind a
 * `Suspense` boundary so the page shell (topbar chrome) paints immediately.
 *
 * `/planning` is owner/planner ONLY (per the confirmed access decision) —
 * gated on the FULL `update` action, not `update_own` (which an engineer
 * also holds on this same `planning` RBAC module for their own assigned
 * work, via the separate Work Orders list/detail screens). This mirrors
 * `app/(app)/work-orders/page.tsx`'s `hasFeature()` + RBAC two-step exactly,
 * just with a narrower permission check.
 */
export default async function PlanningPage({ searchParams }: PlanningPageProps) {
  const session = await getCurrentSession();
  if (!session?.organization) notFound();
  if (!(await hasFeature(session.organization, "planning"))) notFound();

  const actor: PermissionActor = { role: session.role, isPlatformAdmin: session.isPlatformAdmin };
  if (!can(actor, "planning", "update")) notFound();

  const params = await searchParams;
  const date = parseDateParam(params.date);
  const view: PlanningView =
    parseView(params.view) ??
    parseView((await preferencesStore.getLastUsedView(session.userId, "planning-view")) ?? undefined) ??
    "day";
  const group: PlanningGroup =
    parseGroup(params.group) ??
    parseGroup((await preferencesStore.getLastUsedView(session.userId, "planning-group")) ?? undefined) ??
    "region";

  return (
    <Stack gap="lg" className="ui-planning-page">
      <Suspense key={`${formatDateParam(date)}:${view}:${group}`} fallback={<PlanningBoardSkeleton view={view} />}>
        <PlanningBoard date={date} view={view} group={group} />
      </Suspense>
    </Stack>
  );
}
