"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, EmptyState, Heading, Inline, Input, Select, Stack, Table, Text } from "@yourorg/ui";
import { CalendarDays } from "@yourorg/ui/icons";
import { createTimeEntry, updateTimeEntry, type TimeEntryRecord } from "../time-entries-actions";
import type { OrgMemberRecord } from "@/lib/members/actions";
import { memberDisplayName } from "@/lib/members/format";
import type { ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { DeleteTimeEntryDialog } from "./delete-time-entry-dialog";
import { formatDateTime } from "@/lib/format/date";

export interface TimeEntriesPanelProps {
  workOrderId: string;
  /** Via `listTimeEntries` — for an engineer caller this is already scoped
   * to their own rows by RLS (`time_entries_select_scoped`), same
   * "no app-layer re-filtering needed" lesson `listWorkOrders` documents. */
  timeEntries: TimeEntryRecord[];
  /** This org's members, to resolve `time_entries.user_id` into a display
   * name (`memberDisplayName`) — same directory `work-order-fields.tsx` uses
   * for `assignedTo`. Also filtered down to `role === "engineer"` for the
   * inline Travel/Work row editor's engineer picker (issue #87/#89) —
   * nobody else is a valid time-entry engineer. */
  members: OrgMemberRecord[];
  /** This org's `time_entry_type` picklist values (Labor/Travel/Break), to
   * split `timeEntries` into the Travel/Work sections below by each entry's
   * resolved `value`, and to resolve the fixed "Labor" type a new Work row is
   * created with. */
  entryTypes: ReferenceListItemRecord[];
  /** The work order's own `assigned_to` ("standard engineer", issue #87) —
   * pre-selects a new inline row's engineer picker, mirroring
   * `createTimeEntry`'s own server-side default for an omitted `userId`. */
  assignedTo?: string | null;
  currentUserId: string;
  /** `can(actor, "planning", "create")` — plain create, not `create_own`.
   * Gates the manual Travel/Work "Add" affordances specifically: those let
   * picking WHICH engineer the entry belongs to, which only a caller who can
   * actually log on someone else's behalf (per `createTimeEntry`'s own
   * on-behalf-of logic) may exercise — an engineer's selection there would
   * otherwise be silently discarded server-side. Also gates whether an
   * EXISTING row's inline editor exposes the engineer picker at all (issue
   * #89 — see `TimeEntriesTable`'s own doc comment).
   */
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

/** The inline row editor's in-progress values — shared shape for both a
 * brand-new row ("Add travel/work time") and an existing row being
 * corrected ("Edit"), per issue #89's "identical editable shape" for both.
 * `entryId: null` means "not saved yet" (an Add in progress); `section`
 * fixes which of the two tables this draft belongs to/renders in, and (for
 * a new row) which `time_entry_type` it will be created with — Travel or
 * Labor, exactly as the old `TimeEntryCreateDialog`'s per-section
 * `entryTypeId` prop did. An existing row's own type is deliberately never
 * editable here (same as it never was in the removed `TimeEntryEditDialog`)
 * — only one row across both tables can be in this state at a time. */
interface RowDraft {
  entryId: string | null;
  section: "travel" | "work";
  userId: string;
  startedAtLocal: string;
  endedAtLocal: string;
}

/** Same local helpers every other work-order-adjacent form owns a copy of
 * (`work-order-fields.tsx`'s `toDatetimeLocalValue`/`toIsoDateTime`) — not
 * shared, same "each form owns its own" precedent those files already
 * establish. */
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

/** Row shape shared by the Travel/Work `<Table>`s below — extracted so both
 * only differ in which rows they're given and whether the Type column is
 * shown (Travel's own table is always-Travel, so that column would be
 * redundant there).
 *
 * Issue #89 folded the old `TimeEntryCreateDialog`/`TimeEntryEditDialog`
 * popups into this table directly: `draft` (non-`null` only when it belongs
 * to THIS table's section) renders as an extra editable row — at the top
 * when it's a new, not-yet-saved entry (`draft.entryId === null`), or in
 * place of the matching row when it's an existing one being corrected. */
function TimeEntriesTable({
  entries,
  memberById,
  currentUserId,
  canUpdateAny,
  canUpdateOwn,
  canDelete,
  showType,
  showTypeLabel,
  onStartEdit,
  onDelete,
  draft,
  engineers,
  canLogTimeForOthers,
  saving,
  onDraftChange,
  onSaveDraft,
  onCancelDraft,
  otherDraftActive,
}: {
  entries: TimeEntryRecord[];
  memberById: Map<string, OrgMemberRecord>;
  currentUserId: string;
  canUpdateAny: boolean;
  canUpdateOwn: boolean;
  canDelete: boolean;
  showType: boolean;
  /** Fixed label for a brand-new row's Type cell (Work's "Add" always
   * creates a Labor entry, same as the old dialog) — only rendered when
   * `showType` and the row is a new (`entryId === null`) draft. */
  showTypeLabel?: string;
  onStartEdit: (entry: TimeEntryRecord) => void;
  onDelete: (entry: TimeEntryRecord) => void;
  draft: RowDraft | null;
  engineers: OrgMemberRecord[];
  canLogTimeForOthers: boolean;
  saving: boolean;
  onDraftChange: (patch: Partial<RowDraft>) => void;
  onSaveDraft: () => void;
  onCancelDraft: () => void;
  /** A draft is active elsewhere (a different row/section) — disables this
   * table's own Edit affordances so only one row across the whole panel is
   * ever mid-edit at a time. */
  otherDraftActive: boolean;
}) {
  const showActionsColumn = canUpdateAny || canUpdateOwn || canDelete;
  const newRowDraft = draft && draft.entryId === null ? draft : null;

  function renderDraftRow(key: string, existing: TimeEntryRecord | null) {
    // An engineer correcting their OWN row never gets to reassign it to
    // someone else (RLS backstops this independently regardless — see
    // `time-entries-actions.ts`'s module comment) — shown as plain text
    // instead of a `<Select>` in that case. A brand-new row is only ever
    // reachable via the "Add" buttons, which are themselves gated on
    // `canLogTimeForOthers` (see `TimeEntriesPanel` below), so it always
    // gets the interactive picker.
    const engineerEditable = !existing || canLogTimeForOthers;
    return (
      <Table.Row key={key}>
        <Table.Cell>
          {engineerEditable ? (
            <Select
              // Entering edit mode always introduces a brand-new `<select>`
              // DOM node at this position (read mode renders plain text
              // here, never a `Select`), so `autoFocus` genuinely fires on
              // that mount — it does NOT refire on later keystrokes, since
              // the node stays mounted across those re-renders. Replaces the
              // `Dialog` popups' own auto-focus-on-open behavior (issue #89
              // QA follow-up: without this, a keyboard/screen-reader user's
              // focus was silently dropped back to `<body>` on every edit).
              autoFocus
              aria-label="Engineer"
              value={draft!.userId}
              onChange={(event) => onDraftChange({ userId: event.target.value })}
              disabled={saving}
            >
              {!draft!.userId && (
                <option value="" disabled>
                  Select an engineer…
                </option>
              )}
              {engineers.map((engineer) => (
                <option key={engineer.id} value={engineer.id}>
                  {memberDisplayName(engineer)}
                </option>
              ))}
            </Select>
          ) : (
            memberDisplayName(memberById.get(draft!.userId))
          )}
        </Table.Cell>
        {showType && (
          <Table.Cell>
            {existing ? (
              <Badge color={existing.time_entry_type?.color} variant="muted">
                {existing.time_entry_type?.label ?? "—"}
              </Badge>
            ) : (
              <Badge variant="muted">{showTypeLabel ?? "—"}</Badge>
            )}
          </Table.Cell>
        )}
        <Table.Cell>
          <Input
            // Only takes the initial focus when there's no Engineer select
            // in this row to take it instead (see that field's own comment).
            autoFocus={!engineerEditable}
            aria-label="Started"
            type="datetime-local"
            value={draft!.startedAtLocal}
            onChange={(event) => onDraftChange({ startedAtLocal: event.target.value })}
            disabled={saving}
          />
        </Table.Cell>
        <Table.Cell>
          <Input
            aria-label="Ended"
            type="datetime-local"
            value={draft!.endedAtLocal}
            onChange={(event) => onDraftChange({ endedAtLocal: event.target.value })}
            disabled={saving}
          />
        </Table.Cell>
        <Table.Cell>—</Table.Cell>
        {showActionsColumn && (
          <Table.Cell align="center">
            <Inline gap="sm" align="center">
              <Button type="button" variant="primary" size="sm" onClick={onSaveDraft} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={onCancelDraft} disabled={saving}>
                Cancel
              </Button>
            </Inline>
          </Table.Cell>
        )}
      </Table.Row>
    );
  }

  return (
    <Table>
      <Table.Head>
        <Table.Row>
          <Table.HeaderCell>Engineer</Table.HeaderCell>
          {showType && <Table.HeaderCell>Type</Table.HeaderCell>}
          <Table.HeaderCell>Started</Table.HeaderCell>
          <Table.HeaderCell>Ended</Table.HeaderCell>
          <Table.HeaderCell>Duration</Table.HeaderCell>
          {showActionsColumn && <Table.HeaderCell align="center">Actions</Table.HeaderCell>}
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {entries.map((entry) => {
          if (draft && draft.entryId === entry.id) {
            return renderDraftRow(entry.id, entry);
          }
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
              {showActionsColumn && (
                <Table.Cell align="center">
                  <Inline gap="sm" align="center">
                    {canEditRow && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onStartEdit(entry)}
                        disabled={otherDraftActive}
                      >
                        Edit
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        onClick={() => onDelete(entry)}
                        disabled={otherDraftActive}
                      >
                        Delete
                      </Button>
                    )}
                  </Inline>
                </Table.Cell>
              )}
            </Table.Row>
          );
        })}
        {newRowDraft && renderDraftRow("new-row-draft", null)}
      </Table.Body>
    </Table>
  );
}

/**
 * "Time Entries" — the `time_entries` sub-resource of one Work Order,
 * surfaced in-context on its detail page per docs/ARCHITECTURE.md
 * "Relational detail pages" / "Popup vs. full page": a compact Travel/Work
 * list is the right weight here, not a separate route — same shape
 * `ContractAssetsPanel` gives Contracts' Linked Assets.
 *
 * **Issue #87 ("Workorder uitbreiding")** split this into two explicit
 * sections — Travel times (`time_entry_type.value === "travel"`) and Work
 * times (everything else: Labor, plus Break folded in here as a sub-type
 * rather than given its own section or dropped).
 *
 * **Issue #89 ("New/Edit work order screens aligned")** replaced that split's
 * `TimeEntryCreateDialog`/`TimeEntryEditDialog` popups with genuine inline
 * table-row editing: "Add travel/work time" appends a new editable row
 * directly into that section's `<Table>` (see `TimeEntriesTable` above)
 * instead of opening a `Dialog`, and a row's own "Edit" turns that same row
 * into the identical editable shape in place. Both write through the exact
 * same `createTimeEntry`/`updateTimeEntry` Server Actions the old dialogs
 * called — nothing changed backend-side, only how the caller reaches them.
 * `DeleteTimeEntryDialog` is untouched (a destructive confirm dialog is
 * still the right weight there).
 *
 * The Travel/Work inline rows expose an engineer picker for on-behalf-of
 * logging (an already-complete, or already-known-start, entry logged after
 * the fact) when `canLogTimeForOthers` — see `TimeEntriesTable`'s own doc
 * comment for exactly when. The former "clock in/out" running-timer
 * affordance and its Notes column were removed from this panel; `clockIn`/
 * `clockOut` still exist as Server Actions in `time-entries-actions.ts` for
 * any future caller, just unused here now.
 */
export function TimeEntriesPanel({
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
}: TimeEntriesPanelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<RowDraft | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<TimeEntryRecord | null>(null);

  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const engineers = useMemo(() => members.filter((member) => member.role === "engineer"), [members]);

  const travelType = entryTypes.find((item) => item.value === "travel");
  const laborType = entryTypes.find((item) => item.value === "labor");

  const travelEntries = timeEntries.filter((entry) => entry.time_entry_type?.value === "travel");
  // "Work times" folds Break in as a sub-type alongside Labor (issue #87:
  // "Decide where Break entries display... don't drop Break entries from the
  // UI entirely") — anything that isn't Travel lands here.
  const workEntries = timeEntries.filter((entry) => entry.time_entry_type?.value !== "travel");

  const defaultEngineerId = engineers.some((engineer) => engineer.id === assignedTo) ? (assignedTo ?? "") : "";

  function startAdd(section: "travel" | "work") {
    setError(null);
    setDraft({
      entryId: null,
      section,
      userId: defaultEngineerId,
      startedAtLocal: toDatetimeLocalValue(new Date().toISOString()),
      endedAtLocal: "",
    });
  }

  function startEdit(entry: TimeEntryRecord) {
    setError(null);
    setDraft({
      entryId: entry.id,
      section: entry.time_entry_type?.value === "travel" ? "travel" : "work",
      userId: entry.user_id,
      startedAtLocal: toDatetimeLocalValue(entry.started_at),
      endedAtLocal: toDatetimeLocalValue(entry.ended_at),
    });
  }

  function updateDraft(patch: Partial<RowDraft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function cancelDraft() {
    setDraft(null);
    setError(null);
  }

  function saveDraft() {
    if (!draft) return;
    if (!draft.userId || !draft.startedAtLocal) {
      setError("Select an engineer and a start date/time.");
      return;
    }
    setError(null);
    setSaving(true);
    startTransition(async () => {
      const result = draft.entryId
        ? await updateTimeEntry(draft.entryId, {
            userId: draft.userId,
            startedAt: toIsoDateTime(draft.startedAtLocal),
            endedAt: toIsoDateTime(draft.endedAtLocal),
          })
        : await createTimeEntry(workOrderId, {
            userId: draft.userId,
            entryTypeId: draft.section === "travel" ? travelType?.id : laborType?.id,
            startedAt: toIsoDateTime(draft.startedAtLocal),
            endedAt: toIsoDateTime(draft.endedAtLocal),
          });
      setSaving(false);
      if (!result.data) {
        setError(result.error ?? "Could not save this time entry.");
        return;
      }
      setDraft(null);
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
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => startAdd("travel")}
                disabled={draft !== null}
              >
                Add travel time
              </Button>
            )}
          </Inline>
          {travelEntries.length === 0 && !(draft?.section === "travel") ? (
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
              onStartEdit={startEdit}
              onDelete={setDeletingEntry}
              draft={draft?.section === "travel" ? draft : null}
              engineers={engineers}
              canLogTimeForOthers={canLogTimeForOthers}
              saving={saving}
              onDraftChange={updateDraft}
              onSaveDraft={saveDraft}
              onCancelDraft={cancelDraft}
              otherDraftActive={draft !== null && draft.section !== "travel"}
            />
          )}
        </Stack>

        <Stack gap="sm">
          <Inline gap="sm" align="center" justify="between">
            <Heading level={4}>Work times</Heading>
            {canLogTimeForOthers && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => startAdd("work")}
                disabled={draft !== null}
              >
                Add work time
              </Button>
            )}
          </Inline>
          {workEntries.length === 0 && !(draft?.section === "work") ? (
            <EmptyState
              icon={<CalendarDays />}
              heading="No work time logged yet"
              text="Add a work time entry to start tracking time against this work order."
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
              showTypeLabel={laborType?.label ?? "Labor"}
              onStartEdit={startEdit}
              onDelete={setDeletingEntry}
              draft={draft?.section === "work" ? draft : null}
              engineers={engineers}
              canLogTimeForOthers={canLogTimeForOthers}
              saving={saving}
              onDraftChange={updateDraft}
              onSaveDraft={saveDraft}
              onCancelDraft={cancelDraft}
              otherDraftActive={draft !== null && draft.section !== "work"}
            />
          )}
        </Stack>
      </Stack>

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
