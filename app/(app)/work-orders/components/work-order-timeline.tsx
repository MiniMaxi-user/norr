import type { TimelineItem } from "@yourorg/ui/web";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
import { formatDateTimeWeb } from "@/lib/format/web";
import type { WorkOrderRecord } from "../actions";
import type { TimeEntryRecord } from "../time-entries-actions";
import type { WorkOrderArticleRecord } from "../work-order-articles-actions";
import type { WorkOrderChecklistItemRecord } from "../checklist-actions";

const CLOSED = ["completed", "invoiced"];

interface Event {
  id: string;
  at: string;
  title: TimelineItem["title"];
  actor?: string | null;
}

/**
 * The Work order page's TIMELINE, built from data the page already loads (no
 * new fetch): created / changed / completed stamps, the planned date (open
 * ring, on top), logged time entries, consumed articles and checked checklist
 * items. Newest first, at most 8. Actors are resolved where the table stores a
 * user id the page can name (creator, engineer of a time entry, who checked an
 * item is not stored by name so it is omitted).
 */
export function buildWorkOrderTimeline(input: {
  workOrder: WorkOrderRecord;
  members: OrgMemberRecord[];
  timeEntries: TimeEntryRecord[] | null;
  articles: WorkOrderArticleRecord[] | null;
  checklistItems: WorkOrderChecklistItemRecord[] | null;
  /** Issue #233: the invoice of this work order's quote, when the viewer may read it. */
  invoice?: { invoiceNumber: string | null; invoicedAt: string | null } | null;
  now?: number;
}): TimelineItem[] {
  const { workOrder, members, timeEntries, articles, checklistItems, invoice } = input;
  const now = input.now ?? Date.now();
  const nameOf = (id: string | null | undefined) => {
    const member = id ? members.find((item) => item.id === id) : undefined;
    return member ? memberDisplayName(member) : null;
  };

  const events: Event[] = [
    { id: "created", at: workOrder.created_at, title: "Work order created", actor: nameOf(workOrder.created_by) },
  ];
  const created = new Date(workOrder.created_at).getTime();
  const updated = new Date(workOrder.updated_at).getTime();
  if (Number.isFinite(created) && Number.isFinite(updated) && updated - created > 60_000) {
    events.push({ id: "updated", at: workOrder.updated_at, title: "Details changed" });
  }
  if (workOrder.completed_at) events.push({ id: "completed", at: workOrder.completed_at, title: "Work order completed" });

  for (const entry of timeEntries ?? []) {
    const travel = entry.time_entry_type?.value === "travel";
    events.push({
      id: `time-${entry.id}`,
      at: entry.started_at,
      title: entry.ended_at ? `${travel ? "Travel" : "Work"} time logged` : `${travel ? "Travel" : "Work"} timer started`,
      actor: nameOf(entry.user_id),
    });
  }
  for (const row of articles ?? []) {
    events.push({
      id: `article-${row.id}`,
      at: row.created_at,
      title: `Material added · ${row.article?.description ?? "article"}`,
      actor: nameOf(row.created_by),
    });
  }
  if (invoice?.invoicedAt) {
    events.push({ id: "invoiced", at: invoice.invoicedAt, title: `Invoiced · ${invoice.invoiceNumber ?? "invoice"}` });
  }
  for (const item of checklistItems ?? []) {
    if (item.is_checked && item.checked_at) {
      events.push({ id: `check-${item.id}`, at: item.checked_at, title: `Checked · ${item.label}` });
    }
  }

  const open = !CLOSED.includes(workOrder.work_order_status?.value ?? "");
  const planned: TimelineItem[] =
    open && workOrder.scheduled_at && new Date(workOrder.scheduled_at).getTime() > now
      ? [
          {
            id: "planned",
            title: "Planned visit",
            at: formatDateTimeWeb(workOrder.scheduled_at),
            actor: nameOf(workOrder.assigned_to),
            status: "planned",
          },
        ]
      : [];

  const past = events
    .filter((event) => !Number.isNaN(new Date(event.at).getTime()))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return [
    ...planned,
    ...past.map<TimelineItem>((event, index) => ({
      id: event.id,
      title: event.title,
      at: formatDateTimeWeb(event.at),
      actor: event.actor,
      status: index === 0 ? "latest" : "default",
    })),
  ];
}
