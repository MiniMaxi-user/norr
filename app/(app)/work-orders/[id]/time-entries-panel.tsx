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
import { DeleteTimeEntryDialog } from "./delete-time-entry-dialog";

export interface TimeEntriesPanelProps {
  workOrderId: string;
  /** Via `listTimeEntries` — for an engineer caller this is already scoped
   * to their own rows by RLS (`time_entries_select_scoped`), same
   * "no app-layer re-filtering needed" lesson `listWorkOrders` documents. */
  timeEntries: TimeEntryRecord[];
  /** This org's members, to resolve `time_entries.user_id` into a display
   * name (`memberDisplayName`) — same directory `work-order-form.tsx` uses
   * for `assignedTo`. */
  members: OrgMemberRecord[];
  /** This org's `time_entry_type` picklist values (Labor/Travel/Break), for
   * the clock-in type select and the edit dialog. */
  entryTypes: ReferenceListItemRecord[];
  currentUserId: string;
  /** `canAny(actor, "planning", ["create", "create_own"])` — gates the whole
   * clock in/out affordance. Every role from engineer up to owner/planner
   * has one of these two actions; finance/administratie (plain `read`) never
   * see this section at all. */
  canLogTime: boolean;
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

/**
 * "Time Entries" — the `time_entries` sub-resource of one Work Order,
 * surfaced in-context on its detail page per docs/ARCHITECTURE.md
 * "Relational detail pages" / "Popup vs. full page": small enough that a
 * compact list + a clock in/out affordance is the right weight, not a
 * separate route — same shape `ContractAssetsPanel` gives Contracts' Linked
 * Assets.
 *
 * *** On-behalf-of logging (deliberately not built here) ***: an owner/
 * planner has plain `create` (not just `create_own`) on `planning`, so
 * `clockIn(workOrderId, { userId })` already supports logging time for
 * someone else at the server-action layer (see that module's doc comment).
 * This panel only ever calls it for the current user (no "log time for…"
 * member picker) — that path is rare enough, and would add a second mode to
 * every piece of state here (clock-in form, the "who's currently running"
 * lookup, per-row edit gating), that it's left as a documented follow-up
 * rather than built speculatively. Same reasoning, `userId` reassignment is
 * not exposed in `TimeEntryEditDialog` either.
 */
export function TimeEntriesPanel({
  workOrderId,
  timeEntries,
  members,
  entryTypes,
  currentUserId,
  canLogTime,
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

  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);

  // "Is the current user already clocked in on this work order?" — the
  // clock in/clock out affordance is one or the other, never both, so this
  // is a plain `find`, not a filter.
  const runningOwnEntry = timeEntries.find((entry) => entry.user_id === currentUserId && entry.ended_at === null);

  const showActionsColumn = canUpdateAny || canUpdateOwn || canDelete;

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
      <Stack gap="md">
        <Heading level={3}>Time Entries</Heading>
        {error && <Text tone="danger">{error}</Text>}

        {timeEntries.length === 0 ? (
          <EmptyState
            icon={<CalendarDays />}
            heading="No time logged yet"
            text="Clock in to start tracking time against this work order."
          />
        ) : (
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.HeaderCell>Logged by</Table.HeaderCell>
                <Table.HeaderCell>Type</Table.HeaderCell>
                <Table.HeaderCell>Started</Table.HeaderCell>
                <Table.HeaderCell>Ended</Table.HeaderCell>
                <Table.HeaderCell>Duration</Table.HeaderCell>
                <Table.HeaderCell>Notes</Table.HeaderCell>
                {showActionsColumn && <Table.HeaderCell align="center">Actions</Table.HeaderCell>}
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {timeEntries.map((entry) => {
                // An engineer (update_own only) can only edit their own row —
                // RLS (`time_entries_update_scoped`) enforces this
                // independently regardless, this is purely so the button
                // isn't shown for a row it would just fail on.
                const canEditRow = canUpdateAny || (canUpdateOwn && entry.user_id === currentUserId);
                return (
                  <Table.Row key={entry.id}>
                    <Table.Cell>{memberDisplayName(memberById.get(entry.user_id))}</Table.Cell>
                    <Table.Cell>
                      <Badge color={entry.time_entry_type?.color} variant="muted">
                        {entry.time_entry_type?.label ?? "—"}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>{formatDateTime(entry.started_at)}</Table.Cell>
                    <Table.Cell>{entry.ended_at ? formatDateTime(entry.ended_at) : "—"}</Table.Cell>
                    <Table.Cell>{formatDuration(entry.started_at, entry.ended_at)}</Table.Cell>
                    <Table.Cell>{entry.notes ?? "—"}</Table.Cell>
                    {showActionsColumn && (
                      <Table.Cell align="center">
                        <Inline gap="sm" align="center">
                          {canEditRow && (
                            <Button type="button" variant="outline" size="sm" onClick={() => setEditingEntry(entry)}>
                              Edit
                            </Button>
                          )}
                          {canDelete && (
                            <Button type="button" variant="danger" size="sm" onClick={() => setDeletingEntry(entry)}>
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
        )}

        {canLogTime && (
          <Stack gap="sm">
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
    </Card>
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
