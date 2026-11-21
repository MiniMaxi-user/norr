"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StatusText, WebDataTableCard, toneFromColor, type WebColumn, type WebMenuItem } from "@yourorg/ui/web-client";
import { WebButton } from "@yourorg/ui/web";
import { updateReferenceItem, type ReferenceListItemRecord } from "@/lib/reference-lists/actions";
import { DeleteReferenceItemDialog } from "./delete-reference-item-dialog";
import { ReferenceItemFormDialog } from "./reference-item-form-dialog";

export interface ReferenceListManagerProps {
  /** Card title; omitted on a list page (the frame header carries the name). */
  title?: string;
  /** One-line description of the list, shown above the filters. The frame's
   * header already carries the list's name. */
  description?: string;
  /** e.g. `"asset_type"` — see `lib/reference-lists/schema.ts` `listKeySchema`.
   * The only thing that changes between reference lists; everything else in
   * this component is generic over it. */
  listKey: string;
  items: ReferenceListItemRecord[];
  /** Non-fatal — `listReferenceItems` failing (e.g. transient network) still
   * renders this component with whatever it got (`items` empty), plus this
   * message, rather than crashing the whole page. */
  loadError?: string;
  /**
   * Whether the current actor can add/edit/reorder/delete values (owner
   * only, per the `settings` RBAC entry — see `lib/rbac/permissions.ts`).
   * `false` renders the exact same list read-only.
   */
  canWrite: boolean;
  /** Non-null exactly when `listKey`'s own list is a *dependent* list (e.g.
   * `asset_subtype` -> `"asset_type"`). Drives the parent-item picker in the
   * create/edit dialog, the Parent column and the Parent dropdown. */
  parentListKey: string | null;
  /** Display title for `parentListKey` (e.g. `"Asset Type"`). */
  parentListTitle?: string;
  /** Every item of the parent list, for resolving `parent_item_id` to a label
   * and for the dialog's parent picker. Empty when `parentListKey` is `null`. */
  parentItems: ReferenceListItemRecord[];
  /** Opts this list into the "Default duration (minutes)" column/field
   * (issue #165). Defaults to `false`. */
  showDefaultDuration?: boolean;
  /** Opts this list into the "Invoice interval" column/field (issue #209) — `billing_terms` only. */
  showInvoiceInterval?: boolean;
  /** Opts this list into the "Default in planning" column/field (issue #222) —
   * `activity_type` only (the Planning page pre-selects these types). */
  showPlanningDefault?: boolean;
  /** Opts this list into the "Inactive" column/switch (issue #274) — `asset_status` only. */
  showInactive?: boolean;
}

/**
 * Generic "manage this picklist" UI (design system, issue #222) — fed just a
 * `listKey` + display copy, reused for every tenant-configurable reference
 * list. One card with FilterBar (search, Color and, on a dependent list, Parent
 * dropdowns, Active / Inactive / All) and a table; `+ Value` sits in the
 * FilterBar. The row's ··· menu holds Edit, Move up / Move down (the list's
 * sort order, within the whole list), Deactivate / Activate and Delete
 * (owner only). The create/edit form stays a small dialog.
 */
export function ReferenceListManager({
  title,
  description,
  listKey,
  items,
  loadError,
  canWrite,
  parentListKey,
  parentListTitle,
  parentItems,
  showDefaultDuration = false,
  showInvoiceInterval = false,
  showPlanningDefault = listKey === "activity_type",
  showInactive = listKey === "asset_status",
}: ReferenceListManagerProps) {
  const router = useRouter();
  const sorted = useMemo(() => [...items].sort((a, b) => a.sort_order - b.sort_order), [items]);
  const parentById = useMemo(() => new Map(parentItems.map((item) => [item.id, item])), [parentItems]);
  const isDependent = Boolean(parentListKey);

  const [formState, setFormState] = useState<{ open: boolean; item: ReferenceListItemRecord | null }>({
    open: false,
    item: null,
  });
  const [deleteTarget, setDeleteTarget] = useState<ReferenceListItemRecord | null>(null);
  const [, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  function move(index: number, direction: -1 | 1) {
    const current = sorted[index];
    const target = sorted[index + direction];
    if (!current || !target) return;
    setActionError(null);
    startTransition(async () => {
      // Two items that already share the same `sort_order` (a data
      // inconsistency from an earlier backfill) cannot be swapped.
      if (current.sort_order === target.sort_order) {
        setActionError(
          "These two items already share the same order position (a data inconsistency) — reordering them has no effect. Contact support to have this list’s order repaired.",
        );
        return;
      }
      const [currentResult, targetResult] = await Promise.all([
        updateReferenceItem(current.id, { sortOrder: target.sort_order }),
        updateReferenceItem(target.id, { sortOrder: current.sort_order }),
      ]);
      if (!currentResult.data || !targetResult.data) {
        setActionError(currentResult.error ?? targetResult.error ?? "Could not reorder these items.");
        return;
      }
      router.refresh();
    });
  }

  function setActive(item: ReferenceListItemRecord, isActive: boolean) {
    setActionError(null);
    startTransition(async () => {
      const result = await updateReferenceItem(item.id, { isActive });
      if (!result.data) {
        setActionError(result.error ?? "Could not update this value.");
        return;
      }
      router.refresh();
    });
  }

  const columns = useMemo<WebColumn<ReferenceListItemRecord>[]>(() => {
    const result: WebColumn<ReferenceListItemRecord>[] = [];
    if (canWrite) {
      result.push({
        id: "order",
        header: "Order",
        align: "end",
        sortValue: (row) => row.sort_order,
        render: (row) => String(sorted.findIndex((item) => item.id === row.id) + 1),
      });
    }
    result.push({
      id: "label",
      header: "Label",
      sortValue: (row) => row.label,
      render: (row) => (
        <>
          <span className={row.is_active ? undefined : "web-muted-cell"}>{row.label}</span>
          {row.description ? <span className="web-muted-cell"> · {row.description}</span> : null}
        </>
      ),
    });
    result.push({ id: "value", header: "Value", mono: true, sortValue: (row) => row.value, render: (row) => row.value });
    if (isDependent) {
      result.push({
        id: "parent",
        header: parentListTitle ?? "Parent",
        sortValue: (row) => (row.parent_item_id ? (parentById.get(row.parent_item_id)?.label ?? "") : ""),
        render: (row) => (row.parent_item_id ? (parentById.get(row.parent_item_id)?.label ?? "—") : "—"),
      });
    }
    if (showDefaultDuration) {
      result.push({
        id: "duration",
        header: "Default duration",
        align: "end",
        sortValue: (row) => row.default_duration_minutes,
        render: (row) => (row.default_duration_minutes != null ? `${row.default_duration_minutes} min` : "—"),
      });
    }
    if (showInvoiceInterval) {
      result.push({
        id: "interval",
        header: "Invoice interval",
        align: "end",
        sortValue: (row) => row.interval_months,
        render: (row) => (row.interval_months != null ? `Every ${row.interval_months} mo` : "—"),
      });
    }
    if (showPlanningDefault) {
      result.push({
        id: "planning-default",
        header: "Default in planning",
        sortValue: (row) => (row.planning_default ? 0 : 1),
        render: (row) => (row.planning_default ? "Yes" : "—"),
      });
    }
    if (showInactive) {
      result.push({
        id: "assets-inactive",
        header: "Inactive",
        sortValue: (row) => (row.is_inactive ? 0 : 1),
        render: (row) => (row.is_inactive ? "Yes" : "—"),
      });
    }
    result.push({
      id: "color",
      header: "Color",
      sortValue: (row) => row.color ?? "",
      render: (row) => (row.color ? <StatusText tone={toneFromColor(row.color)}>{row.color}</StatusText> : "—"),
    });
    result.push({
      id: "default",
      header: "Default",
      sortValue: (row) => (row.is_default ? 0 : 1),
      render: (row) => (row.is_default ? "Default" : "—"),
    });
    result.push({
      id: "status",
      header: "Status",
      sortValue: (row) => (row.is_active ? 0 : 1),
      render: (row) => (
        <StatusText display="auto" tone={row.is_active ? "success" : "neutral"}>{row.is_active ? "Active" : "Inactive"}</StatusText>
      ),
    });
    return result;
  }, [canWrite, sorted, isDependent, parentListTitle, parentById, showDefaultDuration, showInvoiceInterval, showPlanningDefault, showInactive]);

  const dropdowns = useMemo(() => {
    const result: {
      id: string;
      label: string;
      getOptions: (row: ReferenceListItemRecord) => { value: string; label: string }[];
    }[] = [
      {
        id: "color",
        label: "Color",
        getOptions: (row) => (row.color ? [{ value: row.color, label: row.color }] : []),
      },
    ];
    if (isDependent) {
      result.unshift({
        id: "parent",
        label: parentListTitle ?? "Parent",
        getOptions: (row) => {
          const parent = row.parent_item_id ? parentById.get(row.parent_item_id) : undefined;
          return parent ? [{ value: parent.id, label: parent.label }] : [];
        },
      });
    }
    return result;
  }, [isDependent, parentListTitle, parentById]);

  const segment = useMemo(
    () => ({
      label: "Show values",
      defaultValue: "all",
      options: [
        { value: "active", label: "Active", match: (row: ReferenceListItemRecord) => row.is_active },
        { value: "inactive", label: "Inactive", match: (row: ReferenceListItemRecord) => !row.is_active },
        { value: "all", label: "All" },
      ] as const,
    }),
    [],
  );

  const rowActions = (row: ReferenceListItemRecord): WebMenuItem[] => {
    const index = sorted.findIndex((item) => item.id === row.id);
    return [
      { key: "edit", label: "Edit…", onSelect: () => setFormState({ open: true, item: row }) },
      { key: "up", label: "Move up", disabled: index <= 0, onSelect: () => move(index, -1) },
      { key: "down", label: "Move down", disabled: index === sorted.length - 1, onSelect: () => move(index, 1) },
      row.is_active
        ? { key: "deactivate", label: "Deactivate", onSelect: () => setActive(row, false) }
        : { key: "activate", label: "Activate", onSelect: () => setActive(row, true) },
      { type: "separator", key: "sep" },
      { key: "delete", label: "Delete", danger: true, onSelect: () => setDeleteTarget(row) },
    ];
  };

  return (
    <div className="web-tab-stack">
      {loadError ? (
        <p className="web-dialog-error" role="alert">
          {loadError}
        </p>
      ) : null}
      {actionError ? (
        <p className="web-dialog-error" role="alert">
          {actionError}
        </p>
      ) : null}

      <WebDataTableCard
        title={title}
        meta={title ? String(items.length) : undefined}
        note={description}
        rows={sorted}
        getRowKey={(row) => row.id}
        columns={columns}
        searchText={(row) =>
          `${row.label} ${row.value} ${row.description ?? ""} ${row.parent_item_id ? (parentById.get(row.parent_item_id)?.label ?? "") : ""}`
        }
        noun="values"
        dropdowns={dropdowns}
        segment={segment}
        urlPrefix="values"
        defaultSort={canWrite ? { columnId: "order", direction: "asc" } : { columnId: "label", direction: "asc" }}
        rowActions={canWrite ? rowActions : undefined}
        rowLabel={(row) => row.label}
        add={
          canWrite ? (
            <WebButton size="filter" onClick={() => setFormState({ open: true, item: null })}>
              + Value
            </WebButton>
          ) : undefined
        }
        emptyAction={canWrite ? "Use + Value to add the first value for this list." : "Nothing configured for this list yet."}
      />

      {canWrite ? (
        <>
          {formState.open ? (
            <ReferenceItemFormDialog
              open
              onOpenChange={(open) => setFormState((s) => ({ ...s, open }))}
              listKey={listKey}
              item={formState.item}
              parentListKey={parentListKey}
              parentListTitle={parentListTitle}
              parentItems={parentItems}
              showDefaultDuration={showDefaultDuration}
              showInvoiceInterval={showInvoiceInterval}
              showPlanningDefault={showPlanningDefault}
              showInactive={showInactive}
            />
          ) : null}
          <DeleteReferenceItemDialog
            open={Boolean(deleteTarget)}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null);
            }}
            item={deleteTarget}
          />
        </>
      ) : null}
    </div>
  );
}
