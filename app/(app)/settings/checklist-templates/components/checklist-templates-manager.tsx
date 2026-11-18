"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { WebButton } from "@yourorg/ui/web";
import { StructureTree, type StructureTreeNode, type WebMenuItem } from "@yourorg/ui/web-client";
import {
  updateChecklistTemplateItem,
  type ChecklistTemplateItemRecord,
  type ChecklistTemplateRecord,
} from "@/lib/checklist-templates/actions";
import { ChecklistTemplateFormDialog } from "./checklist-template-form-dialog";
import { ChecklistTemplateItemFormDialog } from "./checklist-template-item-form-dialog";
import { DeleteChecklistTemplateDialog } from "./delete-checklist-template-dialog";
import { DeleteChecklistTemplateItemDialog } from "./delete-checklist-template-item-dialog";

export interface ChecklistTemplatesManagerProps {
  templates: ChecklistTemplateRecord[];
  /** Every template's items, keyed by `checklist_template_id`, fetched
   * eagerly for all templates in one bulk query (see
   * `ChecklistTemplatesBoard`). */
  itemsByTemplateId: Record<string, ChecklistTemplateItemRecord[]>;
  /** Non-fatal: `listChecklistTemplates` failing still renders the tree
   * (empty) with this message. */
  loadError?: string;
  /** `can(actor, "settings", "create")`, owner only. `false` renders every
   * template and its items read-only. */
  canWrite: boolean;
}

/**
 * Checklist templates (issue #14; design system #222) as a two-level
 * `StructureTree`: each template is a root, its items are the rows below it —
 * the same "template has items" relation the old Disclosure list showed, now
 * the shared tree used by asset Structure / article Bill of materials.
 * `+ Template` sits in the toolbar. A template's ··· menu has Add item
 * (pre-scoped to it), Rename and Delete template; an item's menu has Edit,
 * Move up / Move down (its order within the template, by swapping
 * `sort_order` with the neighbour) and Delete. Required items show
 * "Required" in the status column. Forms stay small dialogs.
 */
export function ChecklistTemplatesManager({
  templates,
  itemsByTemplateId,
  loadError,
  canWrite,
}: ChecklistTemplatesManagerProps) {
  const router = useRouter();
  const [templateForm, setTemplateForm] = useState<{ open: boolean; template: ChecklistTemplateRecord | null }>({
    open: false,
    template: null,
  });
  const [deleteTemplate, setDeleteTemplate] = useState<ChecklistTemplateRecord | null>(null);
  const [itemForm, setItemForm] = useState<{
    open: boolean;
    templateId: string;
    item: ChecklistTemplateItemRecord | null;
  } | null>(null);
  const [deleteItem, setDeleteItem] = useState<ChecklistTemplateItemRecord | null>(null);
  const [, startReordering] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  function move(sorted: ChecklistTemplateItemRecord[], index: number, direction: -1 | 1) {
    const current = sorted[index];
    const target = sorted[index + direction];
    if (!current || !target) return;
    setActionError(null);
    startReordering(async () => {
      const [currentResult, targetResult] = await Promise.all([
        updateChecklistTemplateItem(current.id, { sortOrder: target.sort_order }),
        updateChecklistTemplateItem(target.id, { sortOrder: current.sort_order }),
      ]);
      if (!currentResult.data || !targetResult.data) {
        setActionError(currentResult.error ?? targetResult.error ?? "Could not reorder these items.");
        return;
      }
      router.refresh();
    });
  }

  const nodes = useMemo<StructureTreeNode[]>(
    () =>
      templates.map((template) => {
        const sorted = [...(itemsByTemplateId[template.id] ?? [])].sort((a, b) => a.sort_order - b.sort_order);
        const templateActions: WebMenuItem[] = canWrite
          ? [
              {
                key: "add",
                label: "Add item…",
                onSelect: () => setItemForm({ open: true, templateId: template.id, item: null }),
              },
              { key: "rename", label: "Rename…", onSelect: () => setTemplateForm({ open: true, template }) },
              { type: "separator", key: "sep" },
              { key: "delete", label: "Delete template", danger: true, onSelect: () => setDeleteTemplate(template) },
            ]
          : [];
        return {
          id: template.id,
          label: template.name,
          status: { label: `${sorted.length} item${sorted.length === 1 ? "" : "s"}`, tone: "neutral" },
          actions: templateActions,
          children: sorted.map((item, index): StructureTreeNode => ({
            id: item.id,
            label: item.label,
            status: item.is_required ? { label: "Required", tone: "warning" } : null,
            actions: canWrite
              ? [
                  {
                    key: "edit",
                    label: "Edit…",
                    onSelect: () => setItemForm({ open: true, templateId: template.id, item }),
                  },
                  { key: "up", label: "Move up", disabled: index === 0, onSelect: () => move(sorted, index, -1) },
                  {
                    key: "down",
                    label: "Move down",
                    disabled: index === sorted.length - 1,
                    onSelect: () => move(sorted, index, 1),
                  },
                  { type: "separator", key: "sep" },
                  { key: "delete", label: "Delete", danger: true, onSelect: () => setDeleteItem(item) },
                ]
              : [],
            children: [],
          })),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [templates, itemsByTemplateId, canWrite],
  );

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

      <StructureTree
        title="Checklist templates"
        nodes={nodes}
        noun="templates and items"
        currentLabel="this template"
        childNoun="items"
        treeHeader="Template / item"
        statusHeader="Items / required"
        ariaLabel="Checklist templates"
        add={
          canWrite ? (
            <WebButton size="filter" onClick={() => setTemplateForm({ open: true, template: null })}>
              + Template
            </WebButton>
          ) : undefined
        }
        emptyText={
          canWrite
            ? "No checklist templates yet. Use + Template to add one you can attach to any work order."
            : "No checklist templates yet."
        }
      />

      {canWrite ? (
        <>
          {templateForm.open ? (
            <ChecklistTemplateFormDialog
              open
              onOpenChange={(open) => setTemplateForm((state) => ({ ...state, open }))}
              template={templateForm.template}
            />
          ) : null}
          <DeleteChecklistTemplateDialog
            open={Boolean(deleteTemplate)}
            onOpenChange={(open) => {
              if (!open) setDeleteTemplate(null);
            }}
            template={deleteTemplate}
          />
          {itemForm?.open ? (
            <ChecklistTemplateItemFormDialog
              open
              onOpenChange={(open) => {
                if (!open) setItemForm(null);
              }}
              templateId={itemForm.templateId}
              item={itemForm.item}
            />
          ) : null}
          <DeleteChecklistTemplateItemDialog
            open={Boolean(deleteItem)}
            onOpenChange={(open) => {
              if (!open) setDeleteItem(null);
            }}
            item={deleteItem}
          />
        </>
      ) : null}
    </div>
  );
}
