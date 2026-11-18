"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@yourorg/ui";
import { WebButton, WebFigures } from "@yourorg/ui/web";
import { WebConfirmDialog, WebDataTableCard, type WebColumn, type WebMenuItem } from "@yourorg/ui/web-client";
import { computeRoundedMinutes } from "@yourorg/time-rounding";
import {
  clockOut,
  createTimeEntry,
  deleteTimeEntry,
  updateTimeEntry,
  type TimeEntryRecord,
} from "../time-entries-actions";
import type { WorkOrderCostSummary } from "../quote-sync-actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import type { OrganizationTimeRoundingSettings } from "@/app/(app)/settings/organization-time-rounding-actions";
import { formatDateTimeWeb, formatMoneyWeb } from "@/lib/format/web";
import { elapsedMinutes, formatHoursMinutes } from "./format-work-order-time";

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIsoDateTime(local: string): string {
  if (!local) return "";
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

type Kind = "travel" | "work";
const kindOf = (entry: TimeEntryRecord): Kind => (entry.time_entry_type?.value === "travel" ? "travel" : "work");

export interface WorkOrderHoursPanelProps {
  workOrderId: string;
  timeEntries: TimeEntryRecord[];
  members: OrgMemberRecord[];
  entryTypes: ReferenceListItemRecord[];
  assignedTo?: string | null;
  currentUserId?: string;
  canLogTimeForOthers: boolean;
  canUpdateAny: boolean;
  canUpdateOwn: boolean;
  canDelete: boolean;
  /** `can(actor, "planning", "read")` + quotes read — gates the cost figures
   * and the missing-rate warning (never shown to an engineer). */
  canSeeCosts?: boolean;
  costSummary?: WorkOrderCostSummary | null;
  unresolvedTimeEntryCount?: number;
  roundingSettings: OrganizationTimeRoundingSettings;
  /** Checked out in the field: time can only be logged/changed in the PWA. */
  locked?: boolean;
}

/**
 * Hours tab (design system, issue #222): figure tiles (this tab is about
 * numbers), then one card with a FilterBar and the time entries as a table.
 * Net (billable, rounded) durations only. `+ Travel` / `+ Work` sit at the
 * right of the FilterBar (the most-used one rightmost) and open the same
 * small dialog as before; Stop / Edit / Delete live in one ··· menu per row.
 * A running entry (`ended_at` null) is highlighted and can be stopped from
 * here (`clockOut`).
 */
export function WorkOrderHoursPanel({
  workOrderId,
  timeEntries,
  members,
  entryTypes,
  assignedTo,
  currentUserId,
  canLogTimeForOthers,
  canUpdateAny,
  canUpdateOwn,
  canDelete,
  canSeeCosts,
  costSummary,
  unresolvedTimeEntryCount = 0,
  roundingSettings,
  locked = false,
}: WorkOrderHoursPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<{ section: Kind; entry: TimeEntryRecord | null } | null>(null);
  const [deleting, setDeleting] = useState<TimeEntryRecord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const engineers = useMemo(() => members.filter((member) => member.role === "engineer"), [members]);
  const travelType = entryTypes.find((item) => item.value === "travel");
  const laborType = entryTypes.find((item) => item.value === "labor");

  const netMinutes = (entry: TimeEntryRecord) => {
    const raw = elapsedMinutes(entry.started_at, entry.ended_at);
    return raw === null ? null : computeRoundedMinutes(raw, roundingSettings[kindOf(entry)]);
  };
  const sumKind = (kind: Kind) =>
    timeEntries.filter((entry) => kindOf(entry) === kind).reduce((sum, entry) => sum + (netMinutes(entry) ?? 0), 0);
  const travelMinutes = sumKind("travel");
  const workMinutes = sumKind("work");

  // Cost figures drop out once the auto-draft quote was promoted (all zero by
  // design) — durations stay accurate either way.
  const showCosts = Boolean(canSeeCosts && costSummary && !costSummary.hasPromotedQuote);

  const canEditRow = (entry: TimeEntryRecord) => canUpdateAny || (canUpdateOwn && entry.user_id === currentUserId);

  async function stop(entry: TimeEntryRecord) {
    const result = await clockOut(entry.id);
    if (!result.data) {
      toast({ title: "Timer not stopped", description: result.error ?? "Could not stop this timer.", tone: "danger", duration: 6000 });
      return;
    }
    toast({ title: "Timer stopped", duration: 3000 });
    router.refresh();
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeletePending(true);
    setDeleteError(null);
    const result = await deleteTimeEntry(deleting.id);
    setDeletePending(false);
    if (result.error) {
      setDeleteError(result.error);
      return;
    }
    setDeleting(null);
    router.refresh();
  }

  const columns = useMemo<WebColumn<TimeEntryRecord>[]>(
    () => [
      {
        id: "type",
        header: "Type",
        sortValue: (entry) => (kindOf(entry) === "travel" ? "Travel" : (entry.time_entry_type?.label ?? "Work")),
        render: (entry) => (kindOf(entry) === "travel" ? "Travel" : (entry.time_entry_type?.label ?? "Work")),
      },
      {
        id: "engineer",
        header: "Engineer",
        sortValue: (entry) => memberDisplayName(memberById.get(entry.user_id)),
        render: (entry) => memberDisplayName(memberById.get(entry.user_id)),
      },
      {
        id: "started",
        header: "Started",
        sortValue: (entry) => entry.started_at,
        render: (entry) => formatDateTimeWeb(entry.started_at),
      },
      {
        id: "ended",
        header: "Ended",
        sortValue: (entry) => entry.ended_at ?? "9999",
        render: (entry) => (entry.ended_at ? formatDateTimeWeb(entry.ended_at) : "Running"),
      },
      {
        id: "duration",
        header: "Duration",
        align: "end",
        sortValue: (entry) => netMinutes(entry),
        render: (entry) => (entry.ended_at ? formatHoursMinutes(netMinutes(entry)) : "—"),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [memberById, roundingSettings],
  );

  const dropdowns = useMemo(
    () => [
      {
        id: "type",
        label: "Type",
        getOptions: (entry: TimeEntryRecord) => [
          kindOf(entry) === "travel" ? { value: "travel", label: "Travel" } : { value: "work", label: "Work" },
        ],
      },
      {
        id: "engineer",
        label: "Engineer",
        getOptions: (entry: TimeEntryRecord) => [
          { value: entry.user_id, label: memberDisplayName(memberById.get(entry.user_id)) },
        ],
      },
    ],
    [memberById],
  );

  const segment = useMemo(
    () => ({
      label: "Show entries",
      defaultValue: "all",
      options: [
        { value: "running", label: "Running", match: (entry: TimeEntryRecord) => !entry.ended_at },
        { value: "done", label: "Done", match: (entry: TimeEntryRecord) => Boolean(entry.ended_at) },
        { value: "all", label: "All" },
      ] as const,
    }),
    [],
  );

  const rowActions = (entry: TimeEntryRecord): WebMenuItem[] => {
    const items: WebMenuItem[] = [];
    if (!entry.ended_at && canEditRow(entry)) items.push({ key: "stop", label: "Stop timer", onSelect: () => void stop(entry) });
    if (canEditRow(entry)) {
      items.push({ key: "edit", label: "Edit…", onSelect: () => setDialog({ section: kindOf(entry), entry }) });
    }
    if (canDelete) {
      if (items.length > 0) items.push({ type: "separator", key: "sep" });
      items.push({
        key: "delete",
        label: "Delete",
        danger: true,
        onSelect: () => {
          setDeleteError(null);
          setDeleting(entry);
        },
      });
    }
    return items;
  };

  const notes = [
    locked ? "Checked out by the engineer — time can only be changed in the field app." : null,
    canSeeCosts && unresolvedTimeEntryCount > 0
      ? `${unresolvedTimeEntryCount} ${unresolvedTimeEntryCount === 1 ? "entry misses" : "entries miss"} a billing rate — set a default rate under Settings → Default Rates, or give the client or engineer a custom rate.`
      : null,
  ].filter(Boolean);

  const defaultEngineerId = engineers.some((engineer) => engineer.id === assignedTo) ? (assignedTo ?? "") : "";

  return (
    <div className="web-tab-stack">
      <WebFigures
        items={[
          {
            label: "Total",
            value: formatHoursMinutes(travelMinutes + workMinutes),
            hint: showCosts ? formatMoneyWeb(costSummary!.travelTotal + costSummary!.laborTotal) : undefined,
          },
          {
            label: "Work",
            value: formatHoursMinutes(workMinutes),
            hint: showCosts ? formatMoneyWeb(costSummary!.laborTotal) : undefined,
          },
          {
            label: "Travel",
            value: formatHoursMinutes(travelMinutes),
            hint: showCosts ? formatMoneyWeb(costSummary!.travelTotal) : undefined,
          },
        ]}
      />

      <WebDataTableCard
        title="Hours"
        meta={`${timeEntries.length}${timeEntries.some((entry) => !entry.ended_at) ? " · 1 running" : ""}`}
        rows={timeEntries}
        getRowKey={(entry) => entry.id}
        columns={columns}
        searchText={(entry) =>
          [memberDisplayName(memberById.get(entry.user_id)), entry.time_entry_type?.label, entry.notes].filter(Boolean).join(" ")
        }
        noun="time entries"
        dropdowns={dropdowns}
        segment={segment}
        urlPrefix="hours"
        defaultSort={{ columnId: "started", direction: "desc" }}
        rowActions={rowActions}
        rowLabel={(entry) => `${kindOf(entry)} entry`}
        isAttention={(entry) => !entry.ended_at}
        note={notes.length > 0 ? notes.join(" ") : undefined}
        add={
          canLogTimeForOthers ? (
            <>
              <WebButton size="filter" onClick={() => setDialog({ section: "travel", entry: null })}>
                + Travel
              </WebButton>
              <WebButton size="filter" onClick={() => setDialog({ section: "work", entry: null })}>
                + Work
              </WebButton>
            </>
          ) : undefined
        }
        emptyAction={canLogTimeForOthers ? "Use + Travel or + Work to log the first hours." : undefined}
      />

      {dialog ? (
        <TimeEntryDialog
          key={`${dialog.section}-${dialog.entry?.id ?? "new"}`}
          workOrderId={workOrderId}
          section={dialog.section}
          entry={dialog.entry}
          engineers={engineers}
          canLogTimeForOthers={canLogTimeForOthers}
          defaultEngineerId={dialog.entry ? "" : defaultEngineerId}
          travelTypeId={travelType?.id}
          laborTypeId={laborType?.id}
          onClose={() => setDialog(null)}
        />
      ) : null}

      <WebConfirmDialog
        open={Boolean(deleting)}
        title="Delete time entry?"
        confirmLabel="Delete"
        confirmVariant="danger"
        pending={deletePending}
        error={deleteError}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      >
        This time entry is removed from the work order. This cannot be undone.
      </WebConfirmDialog>
    </div>
  );
}

function TimeEntryDialog({
  workOrderId,
  section,
  entry,
  engineers,
  canLogTimeForOthers,
  defaultEngineerId,
  travelTypeId,
  laborTypeId,
  onClose,
}: {
  workOrderId: string;
  section: Kind;
  entry: TimeEntryRecord | null;
  engineers: OrgMemberRecord[];
  canLogTimeForOthers: boolean;
  defaultEngineerId: string;
  travelTypeId?: string;
  laborTypeId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [userId, setUserId] = useState(entry?.user_id ?? defaultEngineerId);
  const [startedAtLocal, setStartedAtLocal] = useState(toDatetimeLocalValue(entry?.started_at ?? new Date().toISOString()));
  const [endedAtLocal, setEndedAtLocal] = useState(toDatetimeLocalValue(entry?.ended_at));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const engineerEditable = !entry || canLogTimeForOthers;

  async function handleSave() {
    if (!userId || !startedAtLocal) {
      setError("Select an engineer and a start date and time");
      return;
    }
    setError(null);
    setSaving(true);
    const result = entry
      ? await updateTimeEntry(entry.id, {
          userId,
          startedAt: toIsoDateTime(startedAtLocal),
          endedAt: toIsoDateTime(endedAtLocal),
        })
      : await createTimeEntry(workOrderId, {
          userId,
          entryTypeId: section === "travel" ? travelTypeId : laborTypeId,
          startedAt: toIsoDateTime(startedAtLocal),
          endedAt: toIsoDateTime(endedAtLocal),
        });
    setSaving(false);
    if (!result.data) {
      setError(result.error ?? "Could not save this time entry.");
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <WebConfirmDialog
      open
      title={entry ? "Edit time entry" : section === "travel" ? "Add travel time" : "Add work time"}
      confirmLabel="Save"
      confirmVariant="save"
      pending={saving}
      error={error}
      onCancel={onClose}
      onConfirm={() => void handleSave()}
    >
      <div className="web-dialog-form">
        <div className="web-dialog-field">
          <label className="web-field-label" htmlFor="wo-time-engineer">
            Engineer
          </label>
          {engineerEditable ? (
            <select id="wo-time-engineer" className="web-select" value={userId} onChange={(event) => setUserId(event.target.value)}>
              <option value="">Select an engineer…</option>
              {engineers.map((engineer) => (
                <option key={engineer.id} value={engineer.id}>
                  {memberDisplayName(engineer)}
                </option>
              ))}
            </select>
          ) : (
            <div className="web-field-derived">{memberDisplayName(engineers.find((engineer) => engineer.id === userId))}</div>
          )}
        </div>
        <div className="web-dialog-field">
          <label className="web-field-label" htmlFor="wo-time-start">
            Started
          </label>
          <input
            id="wo-time-start"
            className="web-input"
            type="datetime-local"
            value={startedAtLocal}
            onChange={(event) => setStartedAtLocal(event.target.value)}
          />
        </div>
        <div className="web-dialog-field">
          <label className="web-field-label" htmlFor="wo-time-end">
            Ended
          </label>
          <input
            id="wo-time-end"
            className="web-input"
            type="datetime-local"
            value={endedAtLocal}
            onChange={(event) => setEndedAtLocal(event.target.value)}
          />
        </div>
      </div>
    </WebConfirmDialog>
  );
}
