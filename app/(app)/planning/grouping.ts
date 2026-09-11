import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { TeamMemberRecord } from "@/lib/team/actions";
import type { WorkOrderRecord } from "../work-orders/actions";

/**
 * Region/engineer grouping for the Planning scheduler board (issue #164).
 * Plain, hook-free helpers — safe to call from both the Server Component
 * route (to shape the initial render) and the client shell
 * (`planning-screen.tsx`, re-grouping after an optimistic schedule/
 * unschedule). All region/type grouping happens client-side over the
 * already-fetched rows, per the backend's own `listWorkOrders` doc comment
 * ("there is deliberately no dedicated `listPlanningBoard` action").
 */

export interface PlanningEngineer {
  userId: string;
  name: string;
  avatarUrl: string | null;
  regionId: string | null;
}

export interface PlanningSection {
  /** Region item id, or `"unassigned"`/`"all"` for the two synthetic
   * buckets below. Stable enough to use as a React key. */
  key: string;
  /** `null` for the "Alle monteurs" flat mode — per the confirmed product
   * decision, that mode renders NO region section header/badges at all, the
   * literal opposite of "Per regio", not a variant of it. */
  label: string | null;
  /** The region's own `description` (province subtitle), e.g. "Groningen ·
   * Friesland · Drenthe" — `null` for the flat/unassigned buckets. */
  subtitle: string | null;
  engineers: PlanningEngineer[];
}

export function toPlanningEngineer(member: TeamMemberRecord): PlanningEngineer {
  return {
    userId: member.userId,
    name: member.fullName?.trim() || member.email,
    avatarUrl: member.avatarUrl,
    regionId: member.regionId,
  };
}

/**
 * Builds the scheduler board's sections. `"engineer"` grouping is a single
 * flat section with no label (see `PlanningSection.label`'s own comment).
 * `"region"` grouping renders one section per region (in the org's
 * configured `sort_order`), plus a trailing "Overige monteurs" bucket for
 * any engineer with no `regionId` (or one that no longer resolves to a
 * region item) — engineers should never silently vanish from the board just
 * because they haven't been assigned a region yet.
 */
export function buildEngineerSections(
  group: "region" | "engineer",
  regions: ReferenceListItemRecord[],
  engineers: PlanningEngineer[],
): PlanningSection[] {
  if (group === "engineer") {
    return [{ key: "all", label: null, subtitle: null, engineers }];
  }

  const regionIds = new Set(regions.map((region) => region.id));
  const sections: PlanningSection[] = regions.map((region) => ({
    key: region.id,
    label: region.label,
    subtitle: region.description,
    engineers: engineers.filter((engineer) => engineer.regionId === region.id),
  }));

  const unassigned = engineers.filter((engineer) => !engineer.regionId || !regionIds.has(engineer.regionId));
  if (unassigned.length > 0) {
    sections.push({ key: "unassigned", label: "Overige monteurs", subtitle: null, engineers: unassigned });
  }
  return sections;
}

/** Same region-bucketing shape as `buildEngineerSections`, for the backlog
 * panel's "grouped by region with an hour-total per region group" list —
 * grouped by the work order's SITE's region (`siteRegionById`), not the
 * assigned engineer's (a backlog item has no assignee yet). Work orders with
 * no site, or whose site has no region, fall into an "Onbekende regio"
 * bucket rather than disappearing. */
export interface BacklogRegionGroup {
  key: string;
  label: string;
  workOrders: WorkOrderRecord[];
  totalMinutes: number;
}

export function groupBacklogByRegion(
  workOrders: WorkOrderRecord[],
  regions: ReferenceListItemRecord[],
  siteRegionById: Record<string, string | null>,
): BacklogRegionGroup[] {
  const groups = new Map<string, BacklogRegionGroup>();
  for (const region of regions) {
    groups.set(region.id, { key: region.id, label: region.label, workOrders: [], totalMinutes: 0 });
  }
  const unknown: BacklogRegionGroup = { key: "unknown", label: "Onbekende regio", workOrders: [], totalMinutes: 0 };

  for (const workOrder of workOrders) {
    const regionId = workOrder.site_id ? (siteRegionById[workOrder.site_id] ?? null) : null;
    const group = (regionId && groups.get(regionId)) || unknown;
    group.workOrders.push(workOrder);
    group.totalMinutes += workOrder.duration_minutes ?? 0;
  }

  const result = Array.from(groups.values()).filter((group) => group.workOrders.length > 0);
  if (unknown.workOrders.length > 0) result.push(unknown);
  return result;
}
