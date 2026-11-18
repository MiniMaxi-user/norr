import Link from "next/link";
import type { TimelineItem } from "@yourorg/ui/web";
import type { ActivityRecord } from "@/app/(app)/activities/actions";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import type { AssetVolumesData } from "@/lib/asset-volumes/actions";
import { CLOSED_WORK_ORDER_STATUS_VALUES } from "@/app/(app)/clients/[id]/client-timeline";
import { formatDateTimeWeb } from "@/lib/format/web";
import { workOrderLabel } from "@/lib/format/work-order-label";
import { memberDisplayName } from "@/lib/members/format";
import type { AssetRecord } from "../actions";

const MAX_ITEMS = 8;
const MAX_PLANNED = 2;

interface Event {
  id: string;
  at: string;
  title: TimelineItem["title"];
  actor?: string | null;
}

/**
 * The Asset page's TIMELINE, built from data the page already loads (no new
 * fetch): the asset's own created/changed stamps, plus — for the modules the
 * actor can see — its activities, work orders and the latest volume reading
 * per counter. Newest first; upcoming scheduled work orders are "Planned"
 * (open gold ring) on top. Only activities and readings carry a resolvable
 * actor name.
 */
export function buildAssetTimeline(input: {
  asset: AssetRecord;
  activities: ActivityRecord[] | null;
  workOrders: WorkOrderRecord[] | null;
  volumes: AssetVolumesData | null;
  now?: number;
}): TimelineItem[] {
  const { asset, activities, workOrders, volumes } = input;
  const now = input.now ?? Date.now();
  const events: Event[] = [{ id: "asset-created", at: asset.created_at, title: "Asset created" }];
  const planned: Event[] = [];

  const created = new Date(asset.created_at).getTime();
  const updated = new Date(asset.updated_at).getTime();
  if (Number.isFinite(created) && Number.isFinite(updated) && updated - created > 60_000) {
    events.push({ id: "asset-updated", at: asset.updated_at, title: "Details changed" });
  }

  for (const activity of activities ?? []) {
    events.push({
      id: `activity-${activity.id}`,
      at: activity.reported_at,
      title: (
        <>
          Activity reported ·{" "}
          <Link href={`/activities/${activity.id}`}>{activity.activity_type?.label ?? "Activity"}</Link>
        </>
      ),
      actor: activity.reporter ? memberDisplayName(activity.reporter) : null,
    });
  }

  for (const order of workOrders ?? []) {
    const link = <Link href={`/work-orders/${order.id}`}>{workOrderLabel(order)}</Link>;
    const open = !CLOSED_WORK_ORDER_STATUS_VALUES.includes(order.work_order_status?.value ?? "");
    if (open && order.scheduled_at && new Date(order.scheduled_at).getTime() > now) {
      planned.push({ id: `wo-planned-${order.id}`, at: order.scheduled_at, title: <>Planned: {link}</> });
    }
    events.push({ id: `wo-created-${order.id}`, at: order.created_at, title: <>Work order {link} created</> });
    if (order.completed_at) {
      events.push({ id: `wo-done-${order.id}`, at: order.completed_at, title: <>Work order {link} completed</> });
    }
  }

  for (const counter of volumes?.counters ?? []) {
    const latest = counter.readings[0];
    if (latest) {
      events.push({
        id: `reading-${latest.id}`,
        at: latest.readAt,
        title: `Reading recorded · ${counter.label}`,
        actor: latest.createdByName,
      });
    }
  }

  const past = events
    .filter((event) => !Number.isNaN(new Date(event.at).getTime()))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const upcoming = planned.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()).slice(0, MAX_PLANNED);

  return [
    ...upcoming.map<TimelineItem>((event) => ({
      id: event.id,
      title: event.title,
      at: formatDateTimeWeb(event.at),
      actor: event.actor,
      status: "planned",
    })),
    ...past.slice(0, MAX_ITEMS - upcoming.length).map<TimelineItem>((event, index) => ({
      id: event.id,
      title: event.title,
      at: formatDateTimeWeb(event.at),
      actor: event.actor,
      status: index === 0 ? "latest" : "default",
    })),
  ];
}
