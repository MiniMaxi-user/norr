"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@yourorg/ui";
import { WebButton } from "@yourorg/ui/web";
import { WebConfirmDialog, WebDataTableCard, type WebColumn, type WebMenuItem } from "@yourorg/ui/web-client";
import {
  addAdhocChecklistItem,
  attachChecklistTemplate,
  deleteChecklistItem,
  detachChecklist,
  toggleChecklistItem,
  updateChecklistItemNotes,
  type WorkOrderChecklistItemRecord,
  type WorkOrderChecklistRecord,
} from "../checklist-actions";
import type { ChecklistTemplateRecord } from "@/lib/checklist-templates/actions";
import { formatDateTimeWeb } from "@/lib/format/web";

export interface WorkOrderChecklistPanelProps {
  workOrderId: string;
  checklist: WorkOrderChecklistRecord | null;
  items: WorkOrderChecklistItemRecord[];
  templates: ChecklistTemplateRecord[];
  currentUserId?: string;
  canAttach: boolean;
  canDetach: boolean;
  canUpdateAny: boolean;
  canUpdateOwn: boolean;
}

type Dialog =
  | { kind: "attach" }
  | { kind: "add" }
  | { kind: "note"; item: WorkOrderChecklistItemRecord }
  | { kind: "remove"; item: WorkOrderChecklistItemRecord }
  | { kind: "detach" };

/**
 * Checklist tab (design system, issue #222): the checklist's items as one card
 * with a FilterBar and a table. The Done column is a real checkbox (ticking an
 * item stays a one-click action for whoever may update it); attaching a
 * template, adding an item, editing a note and removing happen through small
 * dialogs and the ··· menu per row. Only rendered at all when the org is
 * entitled to the separately sold `checklists` module (decided server-side).
 */
export function WorkOrderChecklistPanel({
  workOrderId,
  checklist,
  items,
  templates,
  currentUserId,
  canAttach,
  canDetach,
  canUpdateAny,
  canUpdateOwn,
}: WorkOrderChecklistPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");

  const canEditItems = canUpdateAny || (canUpdateOwn && checklist?.assigned_to === currentUserId);

  // Ticking is optimistic: the checkbox flips at once and the server call runs
  // in the background, instead of waiting for the action AND a full page
  // refresh (every tab's data) per click. Overrides are dropped as soon as
  // fresh `items` arrive from the server.
  const [overrides, setOverrides] = useState<Map<string, WorkOrderChecklistItemRecord>>(() => new Map());
  useEffect(() => setOverrides(new Map()), [items]);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);
  const [, startRefresh] = useTransition();

  const merged = useMemo(() => items.map((item) => overrides.get(item.id) ?? item), [items, overrides]);
  const sorted = useMemo(() => [...merged].sort((a, b) => a.sort_order - b.sort_order), [merged]);
  const checkedCount = sorted.filter((item) => item.is_checked).length;

  function open(next: Dialog) {
    setError(null);
    setTemplateId("");
    setLabel("");
    setNote(next.kind === "note" ? (next.item.notes ?? "") : "");
    setDialog(next);
  }

  async function run(task: () => Promise<{ data?: unknown; error?: string }>, fallback: string) {
    setPending(true);
    setError(null);
    const result = await task();
    setPending(false);
    if (!result.data) {
      setError(result.error ?? fallback);
      return;
    }
    setDialog(null);
    router.refresh();
  }

  function setOverride(item: WorkOrderChecklistItemRecord | null, id: string) {
    setOverrides((previous) => {
      const next = new Map(previous);
      if (item) next.set(id, item);
      else next.delete(id);
      return next;
    });
  }

  async function toggle(item: WorkOrderChecklistItemRecord) {
    const nextChecked = !item.is_checked;
    setOverride(
      { ...item, is_checked: nextChecked, checked_at: nextChecked ? new Date().toISOString() : null },
      item.id,
    );
    const result = await toggleChecklistItem(item.id, nextChecked);
    if (!result.data) {
      setOverride(null, item.id);
      toast({ title: "Item not updated", description: result.error ?? "Could not update this item.", tone: "danger", duration: 6000 });
      return;
    }
    setOverride(result.data.item, item.id);
    // Sync the rest of the page (timeline, rail) once the user pauses, in
    // the background so the next tick is never blocked.
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => startRefresh(() => router.refresh()), 1500);
  }

  const columns = useMemo<WebColumn<WorkOrderChecklistItemRecord>[]>(
    () => [
      {
        id: "done",
        header: "Done",
        sortValue: (item) => (item.is_checked ? 1 : 0),
        render: (item) => (
          <input
            type="checkbox"
            className="web-table-checkbox"
            checked={item.is_checked}
            disabled={!canEditItems}
            aria-label={`${item.label}: ${item.is_checked ? "done" : "open"}`}
            onChange={() => void toggle(item)}
          />
        ),
      },
      { id: "item", header: "Item", sortValue: (item) => item.label, render: (item) => item.label },
      {
        id: "required",
        header: "Required",
        sortValue: (item) => (item.is_required ? "Required" : "Optional"),
        render: (item) => (item.is_required ? "Required" : "Optional"),
      },
      {
        id: "checked",
        header: "Checked",
        sortValue: (item) => item.checked_at,
        render: (item) => (item.checked_at ? formatDateTimeWeb(item.checked_at) : "—"),
      },
      { id: "notes", header: "Notes", sortValue: (item) => item.notes ?? "", render: (item) => item.notes || "—" },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEditItems],
  );

  const dropdowns = useMemo(
    () => [
      {
        id: "required",
        label: "Required",
        getOptions: (item: WorkOrderChecklistItemRecord) => [
          item.is_required ? { value: "required", label: "Required" } : { value: "optional", label: "Optional" },
        ],
      },
    ],
    [],
  );

  const segment = useMemo(
    () => ({
      label: "Show items",
      defaultValue: "all",
      options: [
        { value: "open", label: "Open", match: (item: WorkOrderChecklistItemRecord) => !item.is_checked },
        { value: "done", label: "Done", match: (item: WorkOrderChecklistItemRecord) => item.is_checked },
        { value: "all", label: "All" },
      ] as const,
    }),
    [],
  );

  const rowActions = (item: WorkOrderChecklistItemRecord): WebMenuItem[] => {
    const rows: WebMenuItem[] = [];
    if (canEditItems) rows.push({ key: "note", label: "Edit note…", onSelect: () => open({ kind: "note", item }) });
    if (canDetach) {
      if (rows.length > 0) rows.push({ type: "separator", key: "sep" });
      rows.push({ key: "remove", label: "Remove item", danger: true, onSelect: () => open({ kind: "remove", item }) });
    }
    return rows;
  };

  const confirmProps = (() => {
    switch (dialog?.kind) {
      case "attach":
        return {
          title: "Attach checklist",
          confirmLabel: "Attach",
          confirmVariant: "save" as const,
          onConfirm: () => run(() => attachChecklistTemplate(workOrderId, templateId || null), "Could not attach the checklist."),
        };
      case "add":
        return {
          title: "Add item",
          confirmLabel: "Add",
          confirmVariant: "save" as const,
          onConfirm: () => {
            if (!label.trim()) {
              setError("Enter a label for the item");
              return Promise.resolve();
            }
            return run(() => addAdhocChecklistItem(checklist!.id, { label: label.trim() }), "Could not add the item.");
          },
        };
      case "note":
        return {
          title: "Edit note",
          confirmLabel: "Save",
          confirmVariant: "save" as const,
          onConfirm: () => run(() => updateChecklistItemNotes(dialog.item.id, note), "Could not save the note."),
        };
      case "remove":
        return {
          title: "Remove item?",
          confirmLabel: "Remove",
          confirmVariant: "danger" as const,
          onConfirm: () => run(() => deleteChecklistItem(dialog.item.id), "Could not remove the item."),
        };
      case "detach":
        return {
          title: "Detach checklist?",
          confirmLabel: "Detach",
          confirmVariant: "danger" as const,
          onConfirm: () => run(() => detachChecklist(checklist!.id), "Could not detach the checklist."),
        };
      default:
        return null;
    }
  })();

  return (
    <div className="web-tab-stack">
      <WebDataTableCard
        title="Checklist"
        meta={checklist ? `${checkedCount} / ${sorted.length} done` : "none attached"}
        rows={sorted}
        getRowKey={(item) => item.id}
        columns={columns}
        searchText={(item) => `${item.label} ${item.notes ?? ""}`}
        noun="items"
        dropdowns={dropdowns}
        segment={segment}
        urlPrefix="checklist"
        rowActions={rowActions}
        rowLabel={(item) => item.label}
        headerAction={
          checklist && canDetach ? (
            <button type="button" className="web-rail-link" onClick={() => open({ kind: "detach" })}>
              Detach checklist
            </button>
          ) : undefined
        }
        add={
          canAttach ? (
            checklist ? (
              <WebButton size="filter" onClick={() => open({ kind: "add" })}>
                + Item
              </WebButton>
            ) : (
              <WebButton size="filter" onClick={() => open({ kind: "attach" })}>
                + Checklist
              </WebButton>
            )
          ) : undefined
        }
        emptyAction={
          checklist
            ? canAttach
              ? "Use + Item to add the first one."
              : undefined
            : canAttach
              ? "Use + Checklist to attach a template or start blank."
              : "An owner or planner has not attached a checklist yet."
        }
      />

      {confirmProps ? (
        <WebConfirmDialog
          open
          title={confirmProps.title}
          confirmLabel={confirmProps.confirmLabel}
          confirmVariant={confirmProps.confirmVariant}
          pending={pending}
          error={error}
          onCancel={() => setDialog(null)}
          onConfirm={() => void confirmProps.onConfirm()}
        >
          {dialog?.kind === "attach" ? (
            <div className="web-dialog-form">
              <div className="web-dialog-field">
                <label className="web-field-label" htmlFor="wo-checklist-template">
                  Template
                </label>
                <select
                  id="wo-checklist-template"
                  className="web-select"
                  value={templateId}
                  onChange={(event) => setTemplateId(event.target.value)}
                >
                  <option value="">Start blank</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : dialog?.kind === "add" ? (
            <div className="web-dialog-form">
              <div className="web-dialog-field">
                <label className="web-field-label" htmlFor="wo-checklist-label">
                  Item
                </label>
                <input
                  id="wo-checklist-label"
                  className="web-input"
                  value={label}
                  maxLength={200}
                  placeholder="What needs to be checked"
                  onChange={(event) => setLabel(event.target.value)}
                />
              </div>
            </div>
          ) : dialog?.kind === "note" ? (
            <div className="web-dialog-form">
              <div className="web-dialog-field">
                <label className="web-field-label" htmlFor="wo-checklist-note">
                  Note on “{dialog.item.label}”
                </label>
                <textarea
                  id="wo-checklist-note"
                  className="web-textarea"
                  rows={3}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>
            </div>
          ) : dialog?.kind === "remove" ? (
            <>“{dialog.item.label}” is removed from this checklist.</>
          ) : (
            <>The checklist and all its items are removed from this work order. This cannot be undone.</>
          )}
        </WebConfirmDialog>
      ) : null}
    </div>
  );
}
