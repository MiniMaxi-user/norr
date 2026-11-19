import Link from "next/link";
import type { TimelineItem } from "@yourorg/ui/web";
import type { ActivityRecord } from "@/app/(app)/activities/actions";
import type { WorkOrderRecord } from "@/app/(app)/work-orders/actions";
import type { ContractRecord } from "@/app/(app)/contracts/actions";
import type { QuoteRecord } from "@/app/(app)/quotes/actions";
import { formatDateTimeWeb } from "@/lib/format/web";
import { workOrderLabel } from "@/lib/format/work-order-label";
import { contractLabel } from "@/lib/format/contract-label";
import { memberDisplayName } from "@/lib/members/format";
import type { ClientRecord } from "../actions";

/** Most items the rail shows (design system: 5–8). */
/** Planned items shown above the history. */
const MAX_PLANNED = 2;

/** `work_order_status.value`s that mean "done" — see `client-detail.tsx`. */
export const CLOSED_WORK_ORDER_STATUS_VALUES = ["completed", "invoiced"];

interface Event {
  id: string;
  at: string;
  title: TimelineItem["title"];
  actor?: string | null;
}

/**
 * Builds the Client page's TIMELINE from data the page already loads (no new
 * fetch): the client's own created/changed stamps, plus — only for the
 * modules the tenant is entitled to, mirroring each tab's own gate — its
 * activities, work orders, contracts and quotes. Newest first; upcoming
 * scheduled work orders ("Planned: …") sit on top with an open gold ring.
 *
 * Actors: only activities carry a resolvable name (`reporter`); the other
 * tables store a bare user id (`created_by`), so those rows show no actor
 * rather than a guess. A "Details changed" row is only added when
 * `updated_at` is meaningfully later than `created_at` (the table has no
 * change-log to say WHAT changed or WHO did it).
 */
export function buildClientTimeline(input: {
  client: ClientRecord;
  activities: ActivityRecord[] | null;
  workOrders: WorkOrderRecord[] | null;
  contracts: ContractRecord[] | null;
  quotes: QuoteRecord[] | null;
  now?: number;
}): TimelineItem[] {
  const { client, activities, workOrders, contracts, quotes } = input;
  const now = input.now ?? Date.now();
  const events: Event[] = [];
  const planned: Event[] = [];

  events.push({ id: `client-created`, at: client.created_at, title: "Client created" });
  const created = new Date(client.created_at).getTime();
  const updated = new Date(client.updated_at).getTime();
  if (Number.isFinite(created) && Number.isFinite(updated) && updated - created > 60_000) {
    events.push({ id: "client-updated", at: client.updated_at, title: "Details changed" });
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
    const label = workOrderLabel(order);
    const open = !CLOSED_WORK_ORDER_STATUS_VALUES.includes(order.work_order_status?.value ?? "");
    const link = <Link href={`/work-orders/${order.id}`}>{label}</Link>;
    if (open && order.scheduled_at && new Date(order.scheduled_at).getTime() > now) {
      planned.push({ id: `wo-planned-${order.id}`, at: order.scheduled_at, title: <>Planned: {link}</> });
    }
    events.push({ id: `wo-created-${order.id}`, at: order.created_at, title: <>Work order {link} created</> });
    if (order.completed_at) {
      events.push({ id: `wo-done-${order.id}`, at: order.completed_at, title: <>Work order {link} completed</> });
    }
  }

  for (const contract of contracts ?? []) {
    events.push({
      id: `contract-${contract.id}`,
      at: contract.created_at,
      title: (
        <>
          Contract <Link href={`/contracts/${contract.id}`}>{contractLabel(contract)}</Link> added
        </>
      ),
    });
  }

  for (const quote of quotes ?? []) {
    if (quote.is_auto_draft) continue;
    events.push({
      id: `quote-${quote.id}`,
      at: quote.created_at,
      title: (
        <>
          Quote <Link href={`/quotes/${quote.id}`}>{quote.name}</Link> created
        </>
      ),
    });
  }

  const past = events
    .filter((event) => !Number.isNaN(new Date(event.at).getTime()))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const upcoming = planned
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .slice(0, MAX_PLANNED);

  const items: TimelineItem[] = [
    ...upcoming.map<TimelineItem>((event) => ({
      id: event.id,
      title: event.title,
      at: formatDateTimeWeb(event.at),
      actor: event.actor,
      status: "planned",
    })),
    ...past.map<TimelineItem>((event, index) => ({
      id: event.id,
      title: event.title,
      at: formatDateTimeWeb(event.at),
      actor: event.actor,
      status: index === 0 ? "latest" : "default",
    })),
  ];
  return items;
}
