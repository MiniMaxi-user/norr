"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  EmptyState,
  Inline,
  Input,
  Label,
  RowCard,
  SectionHeader,
  Select,
  Stack,
  SummaryRow,
  Text,
  Tooltip,
} from "@yourorg/ui";
import { Clock, Pencil, Trash2 } from "@yourorg/ui/icons";
import { clockOut, createTimeEntry, updateTimeEntry, type TimeEntryRecord } from "../time-entries-actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { DeleteTimeEntryDialog } from "./delete-time-entry-dialog";
import { elapsedMinutes, formatHoursMinutes, formatTimeOfDay } from "./format-work-order-time";

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
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

export interface WorkOrderHoursSectionProps {
  mode: "create" | "edit";
  /** Required for `mode: "edit"`. */
  workOrderId?: string;
  timeEntries: TimeEntryRecord[];
  members: OrgMemberRecord[];
  entryTypes: ReferenceListItemRecord[];
  assignedTo?: string | null;
  currentUserId?: string;
  canLogTimeForOthers: boolean;
  canUpdateAny: boolean;
  canUpdateOwn: boolean;
  canDelete: boolean;
}

/**
 * "Hours" column (issue #102) — replaces `TimeEntriesPanel`'s old two
 * `<Table>`s with a single Travel+Work row list (badge distinguishes the
 * two, matching the mockup) and a `SummaryRow` totals footer. `+ Travel`/
 * `+ Work` open a small `Dialog` (per the issue: "Via +Reis +Werk... krijg
 * je een popup") instead of issue #89's inline draft table row — the
 * underlying `createTimeEntry`/`updateTimeEntry` calls are unchanged, only
 * how the caller reaches them. A running entry (`endedAt: null`) renders
 * with the mockup's amber "in progress" row treatment and a one-click Stop
 * (`clockOut`) — no popup needed for that specific action.
 *
 * `mode: "create"` still renders this whole section (no "two screens"
 * regression) with its `+ Travel`/`+ Work` buttons disabled and a tooltip
 * explaining why — there is no `work_order_id` yet to log time against.
 *
 * *** Issue #106 *** moved the assigned-engineer identity (avatar + name)
 * here, right under the "Hours" header, from `WorkOrderHero`'s own
 * `assignee` block — closer to the hours actually being logged against that
 * engineer, and it frees up the hero's right column for Create Quote/Delete
 * instead. `assignedTo`/`members` were already threaded into this section
 * (they drive the time-entry dialog's default engineer), so this is purely a
 * new read-out, no new data.
 */
export function WorkOrderHoursSection({
  mode,
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
}: WorkOrderHoursSectionProps) {
  const router = useRouter();
  const [dialogSection, setDialogSection] = useState<"travel" | "work" | null>(null);
  const [editingEntry, setEditingEntry] = useState<TimeEntryRecord | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<TimeEntryRecord | null>(null);
  const [, startTransition] = useTransition();
  const [stopError, setStopError] = useState<string | null>(null);

  const memberById = new Map(members.map((member) => [member.id, member]));
  const engineers = members.filter((member) => member.role === "engineer");
  const assignedMember = assignedTo ? memberById.get(assignedTo) : undefined;

  const travelType = entryTypes.find((item) => item.value === "travel");
  const laborType = entryTypes.find((item) => item.value === "labor");

  const travelEntries = timeEntries.filter((entry) => entry.time_entry_type?.value === "travel");
  const workEntries = timeEntries.filter((entry) => entry.time_entry_type?.value !== "travel");

  const travelMinutes = travelEntries.reduce((sum, entry) => sum + (elapsedMinutes(entry.started_at, entry.ended_at) ?? 0), 0);
  const workMinutes = workEntries.reduce((sum, entry) => sum + (elapsedMinutes(entry.started_at, entry.ended_at) ?? 0), 0);

  const disabledHint = "Save the work order first";

  function handleStop(entry: TimeEntryRecord) {
    setStopError(null);
    startTransition(async () => {
      const result = await clockOut(entry.id);
      if (!result.data) {
        setStopError(result.error ?? "Could not stop this timer.");
        return;
      }
      router.refresh();
    });
  }

  function renderRow(entry: TimeEntryRecord, kind: "travel" | "work") {
    const isRunning = !entry.ended_at;
    const canEditRow = canUpdateAny || (canUpdateOwn && entry.user_id === currentUserId);
    return (
      <RowCard key={entry.id} tone={isRunning ? "highlight" : "default"}>
        <Badge variant={kind === "travel" ? "accent" : "success"}>
          {kind === "travel" ? "Travel" : (entry.time_entry_type?.label ?? "Work")}
        </Badge>
        <Text className="ui-work-order-row-main">{memberDisplayName(memberById.get(entry.user_id))}</Text>
        {isRunning ? (
          <Text tone="muted" className="ui-work-order-row-mid ui-tabular-nums">
            {formatTimeOfDay(entry.started_at)} – now
          </Text>
        ) : (
          <Text tone="muted" className="ui-work-order-row-mid ui-tabular-nums">
            {formatTimeOfDay(entry.started_at)} – {formatTimeOfDay(entry.ended_at)}
          </Text>
        )}
        {!isRunning && (
          <Text className="ui-work-order-row-trailing ui-tabular-nums">
            {formatHoursMinutes(elapsedMinutes(entry.started_at, entry.ended_at))}
          </Text>
        )}
        {isRunning && canEditRow && (
          <Button type="button" variant="primary" size="sm" onClick={() => handleStop(entry)}>
            Stop
          </Button>
        )}
        <span className="ui-row-actions ui-work-order-row-actions">
          {canEditRow && (
            <IconEditButton onClick={() => setEditingEntry(entry)} />
          )}
          {canDelete && <IconDeleteButton onClick={() => setDeletingEntry(entry)} />}
        </span>
      </RowCard>
    );
  }

  return (
    <Stack gap="md">
      <SectionHeader
        icon={Clock}
        title="Hours"
        actions={
          <>
            <AddButton
              label="+ Travel"
              disabled={mode === "create" || !canLogTimeForOthers}
              hint={mode === "create" ? disabledHint : undefined}
              onClick={() => setDialogSection("travel")}
            />
            <AddButton
              label="+ Work"
              disabled={mode === "create" || !canLogTimeForOthers}
              hint={mode === "create" ? disabledHint : undefined}
              onClick={() => setDialogSection("work")}
            />
          </>
        }
      />

      {assignedMember && (
        <Inline gap="xs" align="center">
          <Avatar name={memberDisplayName(assignedMember)} size="sm" />
          <Text tone="muted">
            Assigned to <strong>{memberDisplayName(assignedMember)}</strong>
          </Text>
        </Inline>
      )}

      {stopError && <Text tone="danger">{stopError}</Text>}

      {travelEntries.length === 0 && workEntries.length === 0 ? (
        <EmptyState
          icon={<Clock />}
          heading="No hours logged yet"
          text={mode === "create" ? "Save the work order first to start logging time." : "Log travel or work time to start tracking hours against this work order."}
        />
      ) : (
        <>
          <Stack gap="xs">
            {travelEntries.map((entry) => renderRow(entry, "travel"))}
            {workEntries.map((entry) => renderRow(entry, "work"))}
          </Stack>
          <SummaryRow
            className="ui-work-order-summary-row"
            items={[
              { label: "Travel", value: formatHoursMinutes(travelMinutes) },
              { label: "Work", value: formatHoursMinutes(workMinutes) },
              { label: "Total", value: formatHoursMinutes(travelMinutes + workMinutes), emphasis: "bold" },
            ]}
          />
        </>
      )}

      {dialogSection && workOrderId && (
        <WorkOrderTimeEntryDialog
          open
          onOpenChange={(open) => !open && setDialogSection(null)}
          workOrderId={workOrderId}
          section={dialogSection}
          entry={null}
          engineers={engineers}
          canLogTimeForOthers={canLogTimeForOthers}
          defaultEngineerId={engineers.some((engineer) => engineer.id === assignedTo) ? (assignedTo ?? "") : ""}
          travelTypeId={travelType?.id}
          laborTypeId={laborType?.id}
        />
      )}

      {editingEntry && (
        <WorkOrderTimeEntryDialog
          open
          onOpenChange={(open) => !open && setEditingEntry(null)}
          workOrderId={workOrderId!}
          section={editingEntry.time_entry_type?.value === "travel" ? "travel" : "work"}
          entry={editingEntry}
          engineers={engineers}
          canLogTimeForOthers={canLogTimeForOthers}
          defaultEngineerId=""
          travelTypeId={travelType?.id}
          laborTypeId={laborType?.id}
        />
      )}

      {deletingEntry && (
        <DeleteTimeEntryDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeletingEntry(null);
          }}
          timeEntry={deletingEntry}
        />
      )}
    </Stack>
  );
}

function AddButton({
  label,
  disabled,
  hint,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  hint?: string;
  onClick: () => void;
}) {
  const button = (
    <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onClick}>
      {label}
    </Button>
  );
  if (!hint) return button;
  return <Tooltip content={hint}>{button}</Tooltip>;
}

function IconEditButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} aria-label="Edit">
      <Pencil />
    </Button>
  );
}

function IconDeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="danger" size="sm" onClick={onClick} aria-label="Delete">
      <Trash2 />
    </Button>
  );
}

function WorkOrderTimeEntryDialog({
  open,
  onOpenChange,
  workOrderId,
  section,
  entry,
  engineers,
  canLogTimeForOthers,
  defaultEngineerId,
  travelTypeId,
  laborTypeId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string;
  section: "travel" | "work";
  entry: TimeEntryRecord | null;
  engineers: OrgMemberRecord[];
  canLogTimeForOthers: boolean;
  defaultEngineerId: string;
  travelTypeId?: string;
  laborTypeId?: string;
}) {
  const router = useRouter();
  const [userId, setUserId] = useState(entry?.user_id ?? defaultEngineerId);
  const [startedAtLocal, setStartedAtLocal] = useState(
    toDatetimeLocalValue(entry?.started_at ?? new Date().toISOString()),
  );
  const [endedAtLocal, setEndedAtLocal] = useState(toDatetimeLocalValue(entry?.ended_at));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const engineerEditable = !entry || canLogTimeForOthers;

  async function handleSave() {
    if (!userId || !startedAtLocal) {
      setError("Select an engineer and a start date/time.");
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
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm">
      <Dialog.Header>
        <Text>{entry ? "Edit time entry" : section === "travel" ? "Add travel time" : "Add work time"}</Text>
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap="md">
          {error && <Text tone="danger">{error}</Text>}
          <Stack gap="sm">
            <Label htmlFor="wo-time-engineer">Engineer</Label>
            {engineerEditable ? (
              <Select id="wo-time-engineer" value={userId} onChange={(event) => setUserId(event.target.value)}>
                <option value="" disabled>
                  Select an engineer…
                </option>
                {engineers.map((engineer) => (
                  <option key={engineer.id} value={engineer.id}>
                    {memberDisplayName(engineer)}
                  </option>
                ))}
              </Select>
            ) : (
              <Text>{memberDisplayName(engineers.find((engineer) => engineer.id === userId))}</Text>
            )}
          </Stack>
          <Inline gap="sm">
            <Stack gap="sm">
              <Label htmlFor="wo-time-start">Started</Label>
              <Input
                id="wo-time-start"
                type="datetime-local"
                value={startedAtLocal}
                onChange={(event) => setStartedAtLocal(event.target.value)}
              />
            </Stack>
            <Stack gap="sm">
              <Label htmlFor="wo-time-end">Ended</Label>
              <Input
                id="wo-time-end"
                type="datetime-local"
                value={endedAtLocal}
                onChange={(event) => setEndedAtLocal(event.target.value)}
              />
            </Stack>
          </Inline>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
