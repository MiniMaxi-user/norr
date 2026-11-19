import type { LivePanelData } from "@yourorg/ui/web-client";
import type { WorkOrderRecord } from "../actions";
import type { TimeEntryRecord } from "../time-entries-actions";
import { memberDisplayName } from "@/lib/members/format";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { formatTimeOfDay } from "./format-work-order-time";

export interface LivePanelViewer {
  userId: string;
}

export interface WorkOrderLivePanelRecord {
  workOrder: WorkOrderRecord;
  /** `null` = the actor cannot see time entries. */
  timeEntries: TimeEntryRecord[] | null;
  members: OrgMemberRecord[];
  /** May this viewer stop this running entry from here? */
  canStop: (entry: TimeEntryRecord) => boolean;
  /** `can(actor, "planning", "update") && status === to_review`. */
  canApproveReview: boolean;
  /** What still blocks approval (`../approval-readiness.ts`); empty = ready. */
  approvalBlockers: string[];
  /** The one action that fixes the first blocker (Edit, open checklist…). */
  fixAction: { label: string; onClick: () => void } | null;
  /** Review approved (`completed`), no real quote yet, and the viewer may
   * create one — resolved server-side in `[id]/page.tsx`. */
  canCreateQuote: boolean;
  creatingQuote: boolean;
  /** Set once the quote exists: the panel then links to it. */
  createdQuote: { id: string; name: string | null } | null;
  onCreateQuote: () => void;
  onStop: (entry: TimeEntryRecord) => void;
  onApprove: () => void;
}

/**
 * LivePanel of the Work order page — a panel only when something is
 * happening NOW and the viewer can act on it from here (LivePanel rules):
 *
 *  1. the viewer must act: the work order waits in `to_review` and the viewer
 *     may approve it ("ACTION NEEDED FROM YOU", Approve);
 *  2. a time registration is running (own timers first, then anyone's the
 *     viewer may stop): live clock since the start, action Stop.
 *
 *  0. field status (product decision 2026-11-19): while the work order is in
 *     the field flow — scheduled, checked out, en route, in progress — the
 *     panel shows that status with the planned day, times and engineer.
 *
 * Deliberately NOT triggers: any other status (badge), a planned date in the past
 * ("Overdue" is a header badge — nothing hard is due), the missing billing
 * rate (a note on the Hours tab). There is no SLA / deadline data on a work
 * order. More than one trigger => highest priority shown, the rest listed
 * under it. Returns `null` otherwise — also when in doubt.
 */
export function getLivePanel(record: WorkOrderLivePanelRecord, viewer: LivePanelViewer | null): LivePanelData | null {
  const panels: LivePanelData[] = [];

  const field = fieldStatusPanel(record);
  if (field) panels.push(field);

  if (record.canApproveReview) {
    const blockers = record.approvalBlockers;
    panels.push(
      blockers.length === 0
        ? {
            variant: "attention",
            title: "ACTION NEEDED FROM YOU",
            value: "Review",
            context: "Back from the field and complete — approve it to release it for invoicing",
            actions: [{ label: "Approve", onClick: record.onApprove }],
          }
        : {
            variant: "attention",
            title: "REVIEW — NOT READY TO APPROVE",
            value: `${blockers.length} to do`,
            context: blockers.join(" · "),
            actions: record.fixAction ? [record.fixAction] : [],
          },
    );
  }

  if (record.canCreateQuote) {
    panels.push({
      variant: "attention",
      title: "ACTION NEEDED FROM YOU",
      value: "Create quote",
      context: "Review approved — turn the logged hours and material into a quote",
      actions: [
        {
          label: record.creatingQuote ? "Creating quote…" : "Create quote",
          onClick: record.creatingQuote ? undefined : record.onCreateQuote,
        },
      ],
    });
  }

  if (record.createdQuote) {
    panels.push({
      variant: "attention",
      title: "QUOTE CREATED",
      value: record.createdQuote.name || "Quote",
      context: "Made from this work order after approval",
      actions: [{ label: "Open quote", href: `/quotes/${record.createdQuote.id}` }],
    });
  }

  const running = (record.timeEntries ?? [])
    .filter((entry) => !entry.ended_at && record.canStop(entry))
    .sort((a, b) => {
      const mineA = viewer && a.user_id === viewer.userId ? 0 : 1;
      const mineB = viewer && b.user_id === viewer.userId ? 0 : 1;
      return mineA - mineB || new Date(a.started_at).getTime() - new Date(b.started_at).getTime();
    });
  for (const entry of running) {
    const who = record.members.find((member) => member.id === entry.user_id);
    const travel = entry.time_entry_type?.value === "travel";
    panels.push({
      variant: "attention",
      title: "RUNNING TIME REGISTRATION",
      value: { since: entry.started_at },
      context: `${memberDisplayName(who)} · ${travel ? "travel" : "work"} · started ${formatTimeOfDay(entry.started_at)}`,
      actions: [{ label: "Stop timer", onClick: () => record.onStop(entry) }],
    });
  }

  const [first, ...rest] = panels;
  return first ? { ...first, others: rest } : null;
}

/** Field-flow statuses shown in the LivePanel; `scheduled` is calm (info),
 * the engineer actually being out is `attention`. */
const FIELD_STATUSES: Record<string, { title: string; variant: LivePanelData["variant"] }> = {
  scheduled: { title: "SCHEDULED", variant: "info" },
  checkout: { title: "CHECKED OUT BY ENGINEER", variant: "attention" },
  en_route: { title: "ENGINEER EN ROUTE", variant: "attention" },
  in_progress: { title: "ENGINEER AT WORK", variant: "attention" },
};

function fieldStatusPanel(record: WorkOrderLivePanelRecord): LivePanelData | null {
  const { workOrder } = record;
  const status = workOrder.work_order_status;
  const config = status ? FIELD_STATUSES[status.value] : undefined;
  if (!status || !config) return null;

  const parts: string[] = [];
  if (workOrder.scheduled_at) {
    const start = new Date(workOrder.scheduled_at);
    if (!Number.isNaN(start.getTime())) {
      const day = new Intl.DateTimeFormat("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Europe/Amsterdam",
      }).format(start);
      const end =
        workOrder.duration_minutes != null
          ? new Date(start.getTime() + workOrder.duration_minutes * 60000).toISOString()
          : null;
      parts.push(day, end ? `${formatTimeOfDay(workOrder.scheduled_at)}–${formatTimeOfDay(end)}` : formatTimeOfDay(workOrder.scheduled_at));
    }
  } else {
    parts.push("No date planned");
  }
  if (workOrder.assigned_to) {
    const engineer = record.members.find((member) => member.id === workOrder.assigned_to);
    parts.push(memberDisplayName(engineer));
  }

  return {
    variant: config.variant,
    title: config.title,
    value: status.label,
    context: parts.join(" · "),
    actions: [],
  };
}
