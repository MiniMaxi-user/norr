"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, EmptyState, Heading, Inline, Select, Stack, Table, Text } from "@yourorg/ui";
import { CalendarDays } from "@yourorg/ui/icons";
import { clockIn, clockOut, type TimeEntryRecord } from "../time-entries-actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { TimeEntryEditDialog } from "./time-entry-edit-dialog";
import { TimeEntryCreateDialog } from "./time-entry-create-dialog";
import { DeleteTimeEntryDialog } from "./delete-time-entry-dialog";
import { formatDateTime } from "@/lib/format/date";

export interface TimeEntriesPanelProps {
  workOrderId: string;
  /** Via `listTimeEntries` — for an engineer caller this is already scoped
   * to their own rows by RLS (`time_entries_select_scoped`), same
   * "no app-layer re-filtering needed" lesson `listWorkOrders` documents. */
  timeEntries: TimeEntryRecord[];
  /** This org's members, to resolve `time_entries.user_id` into a display
   * name (`memberDisplayName`) — same directory `work-order-form.tsx` uses
   * for `assignedTo`. Also filtered down to `role === "engineer"` for the
   * Travel/Work "Add" dialogs' engineer picker (issue #87) — nobody else is
   * a valid time-entry engineer. */
  members: OrgMemberRecord[];
  /** This org's `time_entry_type` picklist values (Labor/Travel/Break), for
   * the clock-in type select and the edit dialog, and to split `timeEntries`
   * into the Travel/Work sections below by each entry's resolved `value`. */
  entryTypes: ReferenceListItemRecord[];
  /** The work order's own `assigned_to` ("standard engineer", issue #87) —
   * pre-selects the Travel/Work "Add" dialogs' engineer picker, mirroring
   * `createTimeEntry`'s own server-side default for an omitted `userId`. */
  assignedTo?: string | null;
  currentUserId: string;
  /** `canAny(actor, "planning", ["create", "create_own"])` — gates the whole
   * clock in/out affordance. Every role from engineer up to owner/planner has
   * one of these two actions; finance/administratie (plain `read`) never see
   * this section at all. */
  canLogTime: boolean;
  /** `can(actor, "planning", "create")` — plain create, not `create_own`.
   * Gates the manual Travel/Work "Add" dialogs specifically: those let
   * picking WHICH engineer the entry belongs to, which only a caller who can
   * actually log on someone else's behalf (per `createTimeEntry`'s own
   * on-behalf-of logic) may exercise — an engineer's selection there would
   * otherwise be silently discarded server-side. An engineer (`create_own`
   * only) still gets `canLogTime` above for their own clock-in/out. */
  canLogTimeForOthers: boolean;
  /** `can(actor, "planning", "update")` — owner/planner can edit ANY row. */
  canUpdateAny: boolean;
  /** `can(actor, "planning", "update_own")` — an engineer can only edit
   * their own row; checked per-row below against `currentUserId` since
   * `can()` alone can't express "own resource" scoping (see
   * `lib/rbac/permissions.ts`'s `isSelfScoped` doc comment). */
  canUpdateOwn: boolean;
  /** `can(actor, "planning", "delete")` — owner/planner only; an engineer
   * has no delete action on `planning` at all (corrections go through a
   * planner/owner, same conservative precedent as Work Orders themselves). */
  canDelete: boolean;
}

/** Row shape shared by the Travel/Work `<Table>`s below — extracted so both
 * only differ in which rows they're given and whether the Type column is
 * shown (Travel's own table is always-Travel, so that column would be
 * redundant there). */
function TimeEntriesTable({
  entries,
  memberById,
  currentUserId,
  canUpdateAny,
  canUpdateOwn,
  canDelete,
  showType,
  onEdit,
  onDelete,
}: {
  entries: TimeEntryRecord[];
  memberById: Map<string, OrgMemberRecord>;
  currentUserId: string;
  canUpdateAny: boolean;
  canUpdateOwn: boolean;
  canDelete: boolean;
  showType: boolean;
  onEdit: (entry: TimeEntryRecord) => void;
  onDelete: (entry: TimeEntryRecord) => void;
}) {
  const showActionsColumn = canUpdateAny || canUpdateOwn || canDelete;

  return (
    <Table>
      <Table.Head>
        <Table.Row>
          <Table.HeaderCell>Engineer</Table.HeaderCell>
          {showType && <Table.HeaderCell>Type</Table.HeaderCell>}
          <Table.HeaderCell>Started</Table.HeaderCell>
          <Table.HeaderCell>Ended</Table.HeaderCell>
          <Table.HeaderCell>Duration</Table.HeaderCell>
          <Table.HeaderCell>Notes</Table.HeaderCell>
          {showActionsColumn && <Table.HeaderCell align="center">Actions</Table.HeaderCell>}
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {entries.map((entry) => {
          // An engineer (update_own only) can only edit their own row — RLS
          // (`time_entries_update_scoped`) enforces this independently
          // regardless, this is purely so the button isn't shown for a row
          // it would just fail on.
          const canEditRow = canUpdateAny || (canUpdateOwn && entry.user_id === currentUserId);
          return (
            <Table.Row key={entry.id}>
              <Table.Cell>{memberDisplayName(memberById.get(entry.user_id))}</Table.Cell>
              {showType && (
                <Table.Cell>
                  <Badge color={entry.time_entry_type?.color} variant="muted">
                    {entry.time_entry_type?.label ?? "—"}
                  </Badge>
                </Table.Cell>
              )}
              <Table.Cell>{formatDateTime(entry.started_at, { year: false })}</Table.Cell>
              <Table.Cell>{entry.ended_at ? formatDateTime(entry.ended_at, { year: false }) : "—"}</Table.Cell>
              <Table.Cell>{formatDuration(entry.started_at, entry.ended_at)}</Table.Cell>
              <Table.Cell>{entry.notes ?? "—"}</Table.Cell>
              {showActionsColumn && (
                <Table.Cell align="center">
                  <Inline gap="sm" align="center">
                    {canEditRow && (
                      <Button type="button" variant="outline" size="sm" onClick={() => onEdit(entry)}>
                        Edit
                      </Button>
                    )}
                    {canDelete && (
                      <Button type="button" variant="danger" size="sm" onClick={() => onDelete(entry)}>
                        Delete
                      </Button>
                    )}
                  </Inline>
                </Table.Cell>
              )}
            </Table.Row>
          );
        })}
      </Table.Body>
    </Table>
  );
}

/**
 * "Time Entries" — the `time_entries` sub-resource of one Work Order,
 * surfaced in-context on its detail page per docs/ARCHITECTURE.md
 * "Relational detail pages" / "Popup vs. full page": small enough that a
 * compact list + a clock in/out affordance is the right weight, not a
 * separate route — same shape `ContractAssetsPanel` gives Contracts' Linked
 * Assets.
 *
 * **Issue #87 ("Workorder uitbreiding") split this into two explicit
 * sections** — Travel times (`time_entry_type.value === "travel"`) and Work
 * times (everything else: Labor, plus Break folded in here as a sub-type
 * rather than given its own section or dropped) — each its own `<Table>`
 * with its own "Add" affordance opening `TimeEntryCreateDialog` pre-scoped to
 * that section's entry type (no type picker in that dialog — the section
 * already determines it). This is additive: the existing clock in/out flow
 * below (an engineer's own real-time logging) is untouched, and
 * `TimeEntryEditDialog`/`DeleteTimeEntryDialog` are reused unmodified from
 * both tables' row actions rather than forked into type-specific variants.
 *
 * *** On-behalf-of logging for CLOCK IN specifically (deliberately not built
 * here) ***: an owner/planner has plain `create` (not just `create_own`) on
 * `planning`, so `clockIn(workOrderId, { userId })` already supports logging
 * time for someone else at the server-action layer (see that module's doc
 * comment). The clock-in/out block below only ever calls it for the current
 * user (no "log time for…" member picker) — that live "start a running timer
 * for someone else" path is rare enough it's left as a documented follow-up.
 * The Travel/Work "Add" dialogs above are NOT the same case: those log an
 * already-complete (or already-known-start) entry after the fact, which is
 * exactly the on-behalf-of shape the acceptance criteria asked for, so they
 * DO expose an engineer picker.
 */
export function TimeEntriesPanel({
  workOrderId,
  timeEntries,
  members,
  entryTypes,
  assignedTo,
  currentUserId,
  canLogTime,
  canLogTimeForOthers,
  canUpdateAny,
  canUpdateOwn,
  canDelete,
}: TimeEntriesPanelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [clockInEntryTypeId, setClockInEntryTypeId] = useState("");
  const [editingEntry, setEditingEntry] = useState<TimeEntryRecord | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<TimeEntryRecord | null>(null);
  const [addingTravel, setAddingTravel] = useState(false);
  const [addingWork, setAddingWork] = useState(false);

  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const engineers = useMemo(() => members.filter((member) => member.role === "engineer"), [members]);

  const travelType = entryTypes.find((item) => item.value === "travel");
  const laborType = entryTypes.find((item) => item.value === "labor");

  const travelEntries = timeEntries.filter((entry) => entry.time_entry_type?.value === "travel");
  // "Work times" folds Break in as a sub-type alongside Labor (issue #87:
  // "Decide where Break entries display... don't drop Break entries from the
  // UI entirely") — anything that isn't Travel lands here.
  const workEntries = timeEntries.filter((entry) => entry.time_entry_type?.value !== "travel");

  // "Is the current user already clocked in on this work order?" — the
  // clock in/clock out affordance is one or the other, never both, so this
  // is a plain `find`, not a filter.
  const runningOwnEntry = timeEntries.find((entry) => entry.user_id === currentUserId && entry.ended_at === null);

  function handleClockIn() {
    setError(null);
    startTransition(async () => {
      const result = await clockIn(workOrderId, clockInEntryTypeId ? { entryTypeId: clockInEntryTypeId } : {});
      if (!result.data) {
        setError(result.error ?? "Could not clock in.");
        return;
      }
      setClockInEntryTypeId("");
      router.refresh();
    });
  }

  function handleClockOut(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await clockOut(id);
      if (!result.data) {
        setError(result.error ?? "Could not clock out.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <Stack gap="lg">
        <Heading level={3}>Time Entries</Heading>
        {error && <Text tone="danger">{error}</Text>}

        <Stack gap="sm">
          <Inline gap="sm" align="center" justify="between">
            <Heading level={4}>Travel times</Heading>
            {canLogTimeForOthers && (
              <Button type="button" variant="outline" size="sm" onClick={() => setAddingTravel(true)}>
                Add travel time
              </Button>
            )}
          </Inline>
          {travelEntries.length === 0 ? (
            <Text tone="muted">No travel time logged yet.</Text>
          ) : (
            <TimeEntriesTable
              entries={travelEntries}
              memberById={memberById}
              currentUserId={currentUserId}
              canUpdateAny={canUpdateAny}
              canUpdateOwn={canUpdateOwn}
              canDelete={canDelete}
              showType={false}
              onEdit={setEditingEntry}
              onDelete={setDeletingEntry}
            />
          )}
        </Stack>

        <Stack gap="sm">
          <Inline gap="sm" align="center" justify="between">
            <Heading level={4}>Work times</Heading>
            {canLogTimeForOthers && (
              <Button type="button" variant="outline" size="sm" onClick={() => setAddingWork(true)}>
                Add work time
              </Button>
            )}
          </Inline>
          {workEntries.length === 0 ? (
            <EmptyState
              icon={<CalendarDays />}
              heading="No work time logged yet"
              text="Clock in, or add a work time entry, to start tracking time against this work order."
            />
          ) : (
            <TimeEntriesTable
              entries={workEntries}
              memberById={memberById}
              currentUserId={currentUserId}
              canUpdateAny={canUpdateAny}
              canUpdateOwn={canUpdateOwn}
              canDelete={canDelete}
              showType
              onEdit={setEditingEntry}
              onDelete={setDeletingEntry}
            />
          )}
        </Stack>

        {canLogTime && (
          <Stack gap="sm">
            <Text tone="muted">Your time</Text>
            {runningOwnEntry ? (
              <Inline gap="sm" align="center">
                <Text tone="muted">You&rsquo;re clocked in on this work order.</Text>
                <Button
                  type="button"
                  variant="primary"
                  disabled={isPending}
                  onClick={() => handleClockOut(runningOwnEntry.id)}
                >
                  {isPending ? "Clocking out…" : "Clock out"}
                </Button>
              </Inline>
            ) : (
              <Inline gap="sm" align="center">
                <Select
                  aria-label="Time entry type"
                  value={clockInEntryTypeId}
                  onChange={(event) => setClockInEntryTypeId(event.target.value)}
                  disabled={isPending}
                >
                  <option value="">
                    {entryTypes.find((item) => item.is_default)
                      ? `Use default (${entryTypes.find((item) => item.is_default)!.label})`
                      : "Select a type…"}
                  </option>
                  {entryTypes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </Select>
                <Button type="button" variant="primary" disabled={isPending} onClick={handleClockIn}>
                  {isPending ? "Clocking in…" : "Clock in"}
                </Button>
              </Inline>
            )}
          </Stack>
        )}
      </Stack>

      {editingEntry && (
        <TimeEntryEditDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditingEntry(null);
          }}
          timeEntry={editingEntry}
          entryTypes={entryTypes}
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

      {addingTravel && (
        <TimeEntryCreateDialog
          open
          onOpenChange={setAddingTravel}
          workOrderId={workOrderId}
          title="Log travel time"
          entryTypeId={travelType?.id}
          engineers={engineers}
          defaultUserId={assignedTo}
        />
      )}

      {addingWork && (
        <TimeEntryCreateDialog
          open
          onOpenChange={setAddingWork}
          workOrderId={workOrderId}
          title="Log work time"
          entryTypeId={laborType?.id}
          engineers={engineers}
          defaultUserId={assignedTo}
        />
      )}
    </Card>
  );
}

/** `null` `endedAt` means "currently running" (see `time_entries.ended_at`'s
 * column comment in the migration) — rendered as "Running…" rather than a
 * duration computed against `Date.now()`, since this is a server-rendered
 * list, not a live-ticking timer. */
function formatDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return "Running…";
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "—";
  const totalMinutes = Math.round((end - start) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
