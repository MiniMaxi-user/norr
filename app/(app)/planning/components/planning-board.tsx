import { Card, Text } from "@yourorg/ui";
import { listWorkOrders } from "../../work-orders/actions";
import { listTeamMembers } from "@/lib/team/actions";
import { listReferenceItems } from "@/lib/reference-lists/actions";
import { listClients, listSitesForClientIds } from "@/app/(app)/clients/actions";
import { dayRangeIso, weekRangeIso } from "../date-utils";
import { toPlanningEngineer } from "../grouping";
import { PlanningScreen } from "./planning-screen";
import type { PlanningGroup, PlanningView } from "../types";

const FETCH_LIMIT = 200;

export interface PlanningBoardProps {
  date: Date;
  view: PlanningView;
  group: PlanningGroup;
}

/**
 * The data-fetching heart of the Planning module — rendered inside a
 * `Suspense` boundary by `../page.tsx` so its shaped skeleton shows while
 * these `await`s resolve (route-level streaming, per docs/ARCHITECTURE.md).
 *
 * Per `listWorkOrders`' own doc comment (issue #164): there is deliberately
 * no dedicated `listPlanningBoard` action — this calls it twice
 * (`unscheduled: true` for the backlog, `scheduledFrom`/`scheduledTo` for
 * the visible day/week) and does its own region/type grouping client-side
 * over the already-fetched rows (see `../grouping.ts`).
 */
export async function PlanningBoard({ date, view, group }: PlanningBoardProps) {
  const range = view === "week" ? weekRangeIso(date) : dayRangeIso(date);

  const [teamResult, regionResult, activityTypeResult, backlogResult, scheduledResult, clientsResult] =
    await Promise.all([
      listTeamMembers(),
      listReferenceItems("region"),
      listReferenceItems("activity_type"),
      listWorkOrders({ unscheduled: true, limit: FETCH_LIMIT }),
      listWorkOrders({ scheduledFrom: range.from, scheduledTo: range.to, limit: FETCH_LIMIT }),
      listClients({ limit: FETCH_LIMIT }),
    ]);

  if (!teamResult.data || !regionResult.data || !activityTypeResult.data || !backlogResult.data || !scheduledResult.data) {
    return (
      <Card>
        <Text tone="danger">
          {teamResult.error ??
            regionResult.error ??
            activityTypeResult.error ??
            backlogResult.error ??
            scheduledResult.error ??
            "Could not load the planning board."}
        </Text>
      </Card>
    );
  }

  // Backlog panel only ever shows `New` items (product feedback, 2026-09-17)
  // — filtered here against the already-embedded `work_order_status.value`
  // rather than an extra `listWorkOrders` round trip with a `statusId`
  // filter, since `WORK_ORDER_SELECT` already resolves it onto every row.
  const backlog = backlogResult.data.workOrders.filter((wo) => wo.work_order_status?.value === "new");
  const scheduled = scheduledResult.data.workOrders;
  const clients = clientsResult.data?.clients ?? [];
  const clientNameById: Record<string, string> = {};
  for (const client of clients) clientNameById[client.id] = client.name;

  const distinctClientIds = Array.from(new Set([...backlog, ...scheduled].map((wo) => wo.client_id)));
  const sitesResult = await listSitesForClientIds(distinctClientIds);
  const siteRegionById: Record<string, string | null> = {};
  // Address fields for the `WorkOrderQuickView` popup (product feedback,
  // 2026-09-17) — `listSitesForClientIds` already projects `address_line1`/
  // `city` for the Assets map view's pin labels, so this just re-keys the
  // same rows by `id` rather than fetching them again.
  const siteById: Record<string, { address_line1: string | null; city: string | null }> = {};
  for (const site of sitesResult.data?.sites ?? []) {
    siteRegionById[site.id] = site.region_id;
    siteById[site.id] = { address_line1: site.address_line1, city: site.city };
  }

  const engineers = teamResult.data.members.filter((member) => member.role === "engineer").map(toPlanningEngineer);

  return (
    <PlanningScreen
      date={date}
      view={view}
      group={group}
      regions={regionResult.data.items}
      activityTypes={activityTypeResult.data.items}
      engineers={engineers}
      initialBacklog={backlog}
      initialScheduled={scheduled}
      siteRegionById={siteRegionById}
      siteById={siteById}
      clientNameById={clientNameById}
    />
  );
}
